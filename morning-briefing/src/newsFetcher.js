const Parser = require('rss-parser');
const axios = require('axios');
const config = require('./config');
const { summarizeWithClaude } = require('./newsSummarizer');

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

/**
 * Strip HTML tags/entities and collapse whitespace.
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Google News titles look like "Headline - Publisher". Split the publisher off
 * so we can credit the real outlet instead of "Google News".
 */
function splitPublisher(title) {
  const idx = title.lastIndexOf(' - ');
  if (idx <= 0) return { title, publisher: null };
  return { title: title.slice(0, idx).trim(), publisher: title.slice(idx + 3).trim() };
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Read one feed and turn its items into candidate stories.
 */
async function fetchFeed(feed, categoryId) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const cutoff = Date.now() - config.news.maxAgeHours * 3600 * 1000;
    const out = [];

    for (const item of (parsed.items || []).slice(0, config.news.perFeed)) {
      let title = cleanText(item.title);
      let source = feed.name;
      if (feed.aggregator) {
        const split = splitPublisher(title);
        title = split.title;
        if (split.publisher) source = split.publisher;
      }
      if (!title || normalizeTitle(title).length < 15) continue;

      const pubDate = item.isoDate || item.pubDate ? new Date(item.isoDate || item.pubDate) : null;
      if (pubDate && !Number.isNaN(pubDate.getTime()) && pubDate.getTime() < cutoff) continue;

      // Aggregator descriptions are just HTML link lists repeating the title.
      let snippet = feed.aggregator ? '' : cleanText(item.contentSnippet || item.summary || item.content || '');
      if (snippet.toLowerCase().startsWith(title.toLowerCase())) snippet = snippet.slice(title.length).trim();

      out.push({
        category: categoryId,
        title,
        snippet: snippet.slice(0, 600),
        link: item.link || feed.url,
        source,
        pubDate: pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate : null,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[NEWS WARNING] Failed to fetch feed (${categoryId}/${feed.name}):`, err.message);
    return [];
  }
}

/**
 * Collect deduplicated candidate stories for every category.
 * Returns { [categoryId]: candidate[] } with ids assigned, newest first.
 */
async function collectCandidates() {
  const seen = new Set();
  const byCategory = {};

  // Fetch everything in parallel, then dedupe in category order so a story
  // that appears in several categories stays in the first one.
  const results = await Promise.all(
    config.newsCategories.map((cat) => Promise.all(cat.feeds.map((f) => fetchFeed(f, cat.id))))
  );

  config.newsCategories.forEach((cat, ci) => {
    // Interleave feeds so no single outlet dominates the top of the list.
    const perFeed = results[ci].map((items) =>
      items.sort((a, b) => (b.pubDate?.getTime() || 0) - (a.pubDate?.getTime() || 0))
    );
    const merged = [];
    for (let i = 0; perFeed.some((items) => i < items.length); i++) {
      for (const items of perFeed) if (items[i]) merged.push(items[i]);
    }

    const list = [];
    for (const item of merged) {
      const key = normalizeTitle(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ ...item, id: `${cat.id}-${list.length + 1}` });
    }
    byCategory[cat.id] = list;
    console.log(`[NEWS] ${cat.label}: ${list.length} candidate stories`);
  });

  return byCategory;
}

/**
 * Free Google Translate endpoint, used only when Claude is unavailable.
 */
async function translateToKorean(text) {
  if (!text || text.length < 5) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(
      text
    )}`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
    const ko = (res.data?.[0] || []).map((x) => x[0]).join('').replace(/\s+/g, ' ').trim();
    return ko || text;
  } catch (err) {
    console.warn('[TRANSLATE WARNING] Failed to translate:', err.message);
    return text;
  }
}

function trimSentence(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + '…');
}

/**
 * Fallback: newest stories per category, machine-translated.
 */
async function fallbackSelection(candidates, excludeIds = new Set(), count = config.news.perCategory) {
  const picked = candidates.filter((c) => !excludeIds.has(c.id)).slice(0, count);
  return Promise.all(
    picked.map(async (c) => ({
      ...c,
      titleKo: await translateToKorean(c.title),
      summaryKo: c.snippet ? await translateToKorean(trimSentence(c.snippet, 220)) : '',
    }))
  );
}

/**
 * Fetch news, pick the top stories per category and summarize them in Korean.
 * Returns { method: 'claude' | 'translate', categories: [{ id, label, emoji, stories }] }.
 */
async function fetchNews() {
  console.log('[NEWS] Fetching US news by category...');
  const candidates = await collectCandidates();

  let selections = null;
  if (config.claude.apiKey) {
    selections = await summarizeWithClaude(candidates);
  } else {
    console.log('[NEWS] ANTHROPIC_API_KEY not set - using newest stories + machine translation.');
  }

  const categories = [];
  for (const cat of config.newsCategories) {
    const pool = candidates[cat.id] || [];
    let stories = [];

    if (selections && selections[cat.id]) {
      const byId = new Map(pool.map((c) => [c.id, c]));
      for (const sel of selections[cat.id]) {
        const c = byId.get(sel.id);
        if (c && stories.length < config.news.perCategory && !stories.some((s) => s.id === c.id)) {
          stories.push({ ...c, titleKo: sel.title_ko, summaryKo: sel.summary_ko });
        }
      }
    }

    // Top up from the fallback if Claude was unavailable or returned too few.
    if (stories.length < config.news.perCategory) {
      const extra = await fallbackSelection(
        pool,
        new Set(stories.map((s) => s.id)),
        config.news.perCategory - stories.length
      );
      stories = stories.concat(extra);
    }

    categories.push({ id: cat.id, label: cat.label, emoji: cat.emoji, stories });
  }

  const total = categories.reduce((n, c) => n + c.stories.length, 0);
  console.log(`[NEWS] Prepared ${total} stories (${selections ? 'Claude summaries' : 'machine translation'}).`);
  return { method: selections ? 'claude' : 'translate', categories };
}

module.exports = { fetchNews };
