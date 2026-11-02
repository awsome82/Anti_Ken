const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

const SYSTEM_PROMPT = `You are the editor of a Korean-language morning briefing for professionals in Korea who follow the US closely (investors, tech workers).

For each category you receive a numbered list of candidate US news stories (id, outlet, age, headline, and the outlet's own description when available). Pick the ${config.news.perCategory} stories per category that matter most to this reader and write them up in Korean.

Selection:
- Prefer concrete, consequential news: policy decisions, court rulings, economic data releases, central bank moves, earnings and guidance, deals, product launches, regulation, security incidents.
- Skip generic or evergreen pieces: opinion columns, explainers, listicles, "what to know" roundups, lifestyle, celebrity, sports, deal/shopping posts.
- Pick distinct events; if several candidates cover the same event, pick one.
- general = US politics, government, courts, society. economy = macro, markets, companies, trade. tech = technology, AI, big tech, startups, cybersecurity.

Writing:
- title_ko: a natural Korean headline (not a literal translation), up to about 40 characters.
- summary_ko: 2 sentences of plain Korean news style (~120-200 characters) giving what happened and why it matters.
- Use only facts present in the headline and description. Do not add numbers, names, or context that are not in the provided text. If the description is missing, keep the summary to what the headline supports.
- Write company and product names the way Korean media usually do (e.g. Nvidia → 엔비디아); keep tickers and acronyms such as Fed, SEC, AI as is.

Return each chosen story by its id.`;

const OUTPUT_SCHEMA = {
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
          category: { type: 'string', enum: ['general', 'economy', 'tech'] },
          stories: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'title_ko', 'summary_ko'],
              properties: {
                id: { type: 'string' },
                title_ko: { type: 'string' },
                summary_ko: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

function formatCandidates(candidates) {
  const now = Date.now();
  const sections = config.newsCategories.map((cat) => {
    const lines = (candidates[cat.id] || []).map((c) => {
      const age = c.pubDate ? `${Math.max(0, Math.round((now - c.pubDate.getTime()) / 3600000))}h ago` : 'age unknown';
      const desc = c.snippet ? `\n    ${c.snippet}` : '';
      return `[${c.id}] (${c.source}, ${age}) ${c.title}${desc}`;
    });
    return `## ${cat.id}\n${lines.length ? lines.join('\n') : '(no candidates)'}`;
  });
  return sections.join('\n\n');
}

/**
 * Ask Claude to pick and summarize the top stories per category.
 * Returns { [categoryId]: [{ id, title_ko, summary_ko }] }, or null on failure
 * (the caller then falls back to machine translation).
 */
async function summarizeWithClaude(candidates) {
  const total = Object.values(candidates).reduce((n, list) => n + list.length, 0);
  if (total === 0) return null;

  const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 180 * 1000, maxRetries: 2 });
  const model = config.claude.model;

  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Candidate stories:\n\n${formatCandidates(candidates)}` }],
    output_config: {
      effort: config.claude.effort,
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
  };
  if (SERVER_FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  try {
    console.log(`[CLAUDE] Selecting & summarizing ${total} candidates with ${model}...`);
    const response = await client.beta.messages.create(params);

    if (response.stop_reason === 'refusal') {
      console.warn('[CLAUDE WARNING] Request declined:', response.stop_details?.category || 'unknown');
      return null;
    }
    if (response.stop_reason === 'max_tokens') {
      console.warn('[CLAUDE WARNING] Output hit max_tokens; ignoring partial result.');
      return null;
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);

    const result = {};
    for (const cat of parsed.categories || []) result[cat.category] = cat.stories || [];

    const u = response.usage || {};
    console.log(
      `[CLAUDE] Done (served by ${response.model}; input ${u.input_tokens} / output ${u.output_tokens} tokens).`
    );
    return result;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.warn('[CLAUDE WARNING] Invalid ANTHROPIC_API_KEY.');
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn('[CLAUDE WARNING] Rate limited.');
    } else if (err instanceof Anthropic.APIError) {
      console.warn(`[CLAUDE WARNING] API error ${err.status}:`, err.message);
    } else {
      console.warn('[CLAUDE WARNING] Summarization failed:', err.message);
    }
    return null;
  }
}

module.exports = { summarizeWithClaude };
