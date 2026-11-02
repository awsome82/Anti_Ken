const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

/**
 * AI selection + Korean summaries for the news section.
 *
 * Providers, in order of preference:
 *   1. Claude API      - when ANTHROPIC_API_KEY is set (paid)
 *   2. GitHub Models   - when GITHUB_TOKEN is set (free tier, built into Actions)
 * If neither is available or the call fails, the caller falls back to
 * rule-based ranking + machine translation.
 */

const CATEGORY_SCOPE = {
  general: 'US politics, government, courts, society',
  economy: 'US/global macro, markets, companies, trade',
  tech: 'technology, AI, big tech, startups, cybersecurity',
};

function systemPrompt(perCategory) {
  return `You are the editor of a Korean-language morning briefing for professionals in Korea who follow the US closely (investors, tech workers).

You receive candidate news stories (id, outlet, age, number of other outlets covering the same event, headline, and the outlet's own description when available). For each category, pick the ${perCategory} stories that matter most to this reader and write them up in Korean.

Selection:
- Prefer concrete, consequential news: policy decisions, court rulings, economic data, central bank moves, earnings and guidance, deals, product launches, regulation, security incidents. Stories covered by several outlets are usually more important.
- Skip generic or evergreen pieces: opinion, explainers, listicles, roundups, interviews, podcasts, lifestyle, celebrity, sports, shopping.
- Pick distinct events; if several candidates cover the same event, pick one.
- Category scopes: ${Object.entries(CATEGORY_SCOPE)
    .map(([k, v]) => `${k} = ${v}`)
    .join('; ')}.

Writing:
- title_ko: a natural Korean headline (not a literal translation), up to about 40 characters.
- summary_ko: 2 sentences of plain Korean news style (~120-200 characters) giving what happened and why it matters.
- Use only facts present in the headline and description. Do not add numbers, names, or context that are not in the provided text. If the description is missing, keep the summary to what the headline supports.
- Write company and product names the way Korean media usually do (e.g. Nvidia → 엔비디아); keep tickers and acronyms such as Fed, SEC, AI as is.

Return each chosen story by its exact id.`;
}

function formatCandidates(list, maxSnippet) {
  const now = Date.now();
  return list
    .map((c) => {
      const age = c.pubDate ? `${Math.max(0, Math.round((now - c.pubDate.getTime()) / 3600000))}h ago` : 'age unknown';
      const cov = c.coverage ? `, +${c.coverage} outlets` : '';
      const snippet = c.snippet ? c.snippet.slice(0, maxSnippet) : '';
      return `[${c.id}] (${c.source}, ${age}${cov}) ${c.title}${snippet ? `\n    ${snippet}` : ''}`;
    })
    .join('\n');
}

const STORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title_ko', 'summary_ko'],
  properties: { id: { type: 'string' }, title_ko: { type: 'string' }, summary_ko: { type: 'string' } },
};

// ── Claude ─────────────────────────────────────────────────────────────────────

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

async function summarizeWithClaude(candidates) {
  const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 180 * 1000, maxRetries: 2 });
  const model = config.claude.model;
  const ids = config.newsCategories.map((c) => c.id);

  const params = {
    model,
    max_tokens: 16000,
    system: systemPrompt(config.news.perCategory),
    messages: [
      {
        role: 'user',
        content: ids
          .map((id) => `## ${id}\n${formatCandidates(candidates[id] || [], 600) || '(no candidates)'}`)
          .join('\n\n'),
      },
    ],
    output_config: {
      effort: config.claude.effort,
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['categories'],
          properties: {
            categories: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['category', 'stories'],
                properties: {
                  category: { type: 'string', enum: ids },
                  stories: { type: 'array', items: STORY_SCHEMA },
                },
              },
            },
          },
        },
      },
    },
  };
  if (SERVER_FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  try {
    console.log(`[AI] Claude (${model}): selecting & summarizing...`);
    const response = await client.beta.messages.create(params);

    if (response.stop_reason === 'refusal') {
      console.warn('[AI WARNING] Claude declined:', response.stop_details?.category || 'unknown');
      return null;
    }
    if (response.stop_reason === 'max_tokens') {
      console.warn('[AI WARNING] Claude output hit max_tokens; ignoring partial result.');
      return null;
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    const result = {};
    for (const cat of parsed.categories || []) result[cat.category] = cat.stories || [];

    const u = response.usage || {};
    console.log(`[AI] Claude done (served by ${response.model}; in ${u.input_tokens} / out ${u.output_tokens} tokens).`);
    return result;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.warn('[AI WARNING] Invalid ANTHROPIC_API_KEY.');
    else if (err instanceof Anthropic.RateLimitError) console.warn('[AI WARNING] Claude rate limited.');
    else if (err instanceof Anthropic.APIError) console.warn(`[AI WARNING] Claude API error ${err.status}:`, err.message);
    else console.warn('[AI WARNING] Claude summarization failed:', err.message);
    return null;
  }
}

// ── GitHub Models ──────────────────────────────────────────────────────────────

// Tried in order; an endpoint that doesn't return a chat completion is skipped.
const GITHUB_MODELS_URLS = (
  process.env.GITHUB_MODELS_URL ||
  'https://models.github.ai/inference/chat/completions,https://models.inference.ai.azure.com/chat/completions'
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

class EndpointError extends Error {}

/**
 * The free tier caps input at ~8K tokens per request, so we make one small
 * request per category with a trimmed candidate list.
 */
async function githubModelsCategory(url, model, categoryId, list) {
  // The older Azure-hosted endpoint names models without the publisher prefix.
  const modelId = url.includes('models.inference.ai.azure.com') ? model.replace(/^[^/]+\//, '') : model;
  const res = await axios.post(
    url,
    {
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt(config.news.perCategory) },
        {
          role: 'user',
          content:
            `Category: ${categoryId} (${CATEGORY_SCOPE[categoryId]})\n\n${formatCandidates(list, 220)}\n\n` +
            'Respond with JSON only, in this shape: {"stories":[{"id":"...","title_ko":"...","summary_ko":"..."}]}',
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1500,
    },
    {
      headers: {
        Authorization: `Bearer ${config.githubModels.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 60 * 1000,
    }
  );

  if (!res.data || typeof res.data !== 'object' || !Array.isArray(res.data.choices)) {
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new EndpointError(
      `not a chat completion (HTTP ${res.status}, ${res.headers?.['content-type'] || 'no content-type'}): ${(raw || '').slice(0, 200)}`
    );
  }
  const content = res.data.choices[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (err) {
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(
      `unparseable response (HTTP ${res.status}, ${res.headers?.['content-type'] || 'no content-type'}): ${(raw || '').slice(0, 400)}`
    );
  }
  const stories = Array.isArray(parsed.stories) ? parsed.stories : [];
  return stories.filter((s) => s && typeof s.id === 'string' && s.title_ko && s.summary_ko);
}

async function summarizeWithGitHubModels(candidates) {
  let endpoints = [...GITHUB_MODELS_URLS];
  let models = [...config.githubModels.models];
  const result = {};
  let anySuccess = false;

  for (const cat of config.newsCategories) {
    const list = (candidates[cat.id] || []).slice(0, config.githubModels.maxCandidates);
    if (list.length === 0) continue;

    attempts: for (const url of [...endpoints]) {
      const host = new URL(url).host;
      for (const model of [...models]) {
        try {
          console.log(`[AI] GitHub Models (${host}, ${model}): ${cat.id}, ${list.length} candidates...`);
          result[cat.id] = await githubModelsCategory(url, model, cat.id, list);
          anySuccess = true;
          break attempts;
        } catch (err) {
          const status = err.response?.status;
          const detail = err.response?.data?.error?.message || err.response?.data?.message || err.message;
          console.warn(`[AI WARNING] ${host} ${model} failed for ${cat.id}${status ? ` (${status})` : ''}:`, detail);
          const unreachable = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(err.code);
          if (err instanceof EndpointError || unreachable) {
            endpoints = endpoints.filter((u) => u !== url); // endpoint unusable - skip it from now on
            continue attempts;
          }
          if (status === 401 || status === 403) {
            endpoints = endpoints.filter((u) => u !== url);
            continue attempts;
          }
          // Unknown/unsupported model: don't try it again for the next categories.
          if (status === 400 || status === 404) models = models.filter((m) => m !== model);
        }
      }
    }
    if (endpoints.length === 0) break;
  }
  return anySuccess ? result : null;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Returns { provider, selections } where selections is
 * { [categoryId]: [{ id, title_ko, summary_ko }] }, or null when no AI ran.
 */
async function summarizeNews(candidates) {
  const total = Object.values(candidates).reduce((n, list) => n + list.length, 0);
  if (total === 0) return null;

  if (config.claude.apiKey) {
    const selections = await summarizeWithClaude(candidates);
    if (selections) return { provider: 'Claude', selections };
  }
  if (config.githubModels.token) {
    const selections = await summarizeWithGitHubModels(candidates);
    if (selections) return { provider: 'GitHub Models', selections };
  }
  if (!config.claude.apiKey && !config.githubModels.token) {
    console.log('[AI] No AI provider configured (ANTHROPIC_API_KEY / GITHUB_TOKEN).');
  }
  return null;
}

module.exports = { summarizeNews };
