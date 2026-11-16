const Parser = require('rss-parser');
const axios = require('axios');
const config = require('./config');
const { summarizeNews } = require('./newsSummarizer');
const { isExcluded, scoreStories, pickTop, sameEventAsAny } = require('./newsRanker');

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

    const items = (parsed.items || []).slice(0, config.news.perFeed);
    for (let rank = 0; rank < items.length; rank++) {
      const item = items[rank];
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
        feedRank: feed.aggregator ? rank : null, // Google News orders by importance
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

  // Fetch every feed in parallel.
  const results = await Promise.all(
    config.newsCategories.map((cat) => Promise.all(cat.feeds.map((f) => fetchFeed(f, cat.id))))
  );

  // Drop non-news formats, then score on the full set: identical headlines
  // from different outlets (wire stories) are exactly the coverage signal we
  // want, so they must be counted before deduplication.
  let excluded = 0;
  const kept = config.newsCategories.map((cat, ci) =>
    results[ci].flat().filter((item) => {
      if (isExcluded(item)) {
        excluded++;
        return false;
      }
      return true;
    })
  );
  scoreStories(kept.flat());

  // Dedupe exact headlines (first category wins), keep the best-scored copy,
  // and rank within each category.
  config.newsCategories.forEach((cat, ci) => {
    const ranked = [];
    for (const item of [...kept[ci]].sort((a, b) => b.score - a.score)) {
      const key = normalizeTitle(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      ranked.push(item);
    }
    byCategory[cat.id] = ranked.map((item, i) => ({ ...item, id: `${cat.id}-${i + 1}` }));
    console.log(`[NEWS] ${cat.label}: ${ranked.length} candidates`);
  });
  console.log(`[NEWS] Filtered out ${excluded} non-news items (podcasts, opinion, live blogs, deals...).`);

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
 * Fallback: top rule-based stories, machine-translated.
 */
async function fallbackSelection(candidates, alreadyPicked, count) {
  const picked = pickTop(candidates, count, alreadyPicked);
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
 * Returns { provider: 'Claude' | 'GitHub Models' | null, categories: [{ id, label, emoji, stories }] }.
 */
async function fetchNews() {
  console.log('[NEWS] Fetching US news by category...');
  const candidates = await collectCandidates();

  const ai = await summarizeNews(candidates);
  const selections = ai ? ai.selections : null;

  const categories = [];
  const shown = []; // every story picked so far, to avoid repeating an event across categories
  for (const cat of config.newsCategories) {
    const pool = candidates[cat.id] || [];
    let stories = [];

    if (selections && selections[cat.id]) {
      const byId = new Map(pool.map((c) => [c.id, c]));
      for (const sel of selections[cat.id]) {
        const c = byId.get(sel.id);
        if (c && stories.length < config.news.perCategory && !sameEventAsAny(c, shown)) {
          const story = { ...c, titleKo: sel.title_ko, summaryKo: sel.summary_ko };
          stories.push(story);
          shown.push(story);
        }
      }
    }

    // Top up with rule-based picks if no AI ran or it returned too few.
    if (stories.length < config.news.perCategory) {
      const extra = await fallbackSelection(pool, shown, config.news.perCategory - stories.length);
      stories = stories.concat(extra);
      shown.push(...extra);
    }

    categories.push({ id: cat.id, label: cat.label, emoji: cat.emoji, stories });
  }

  const total = categories.reduce((n, c) => n + c.stories.length, 0);
  const provider = ai ? ai.provider : null;
  console.log(`[NEWS] Prepared ${total} stories (${provider ? `AI summaries: ${provider}` : 'rule-based + machine translation'}).`);
  return { provider, categories };
}

module.exports = { fetchNews };
