/**
 * Rule-based news filtering and ranking (no AI, no API keys).
 *
 * - Drops formats that are rarely "news": podcasts, opinion, explainers,
 *   live blogs, newsletters, shopping/deals, quizzes.
 * - Scores stories by how many *other* outlets cover the same event
 *   (cross-coverage is the strongest free signal of importance), with a
 *   small bonus for recency and for Google News' own top-story ordering.
 */

const EXCLUDE_TITLE = [
  /\bpodcast\b/i,
  /\bopinion\b/i,
  /^(?:watch|listen|quiz|video|photos?)\s*[:|-]/i,
  /\bwhat (?:to|you need to) know\b/i,
  /\bhow to\b/i,
  /\bexplained\b|\bexplainer\b/i,
  /\blive(?: updates| blog|:)|\bfollow (?:it )?live\b|\b- live\b/i,
  /\bnewsletter\b|^up first\b/i,
  /\bbest .{0,40}\b(?:deals?|to buy|of 20\d\d)\b|\bdeals?\b.*\b(?:off|sale|discount)\b|\bon sale\b|\bcoupon\b/i,
  /\breview\s*:|\bhands-on\b/i,
  /\bhoroscope\b|\bcrossword\b|\bwordle\b/i,
  /^i (?:tested|tried|used|spent|bought)\b/i, // first-person reviews
  /\bshould you\b|\bwhen (?:to|you should|not to)\b|\bhere'?s (?:how|why|what)\b/i, // advice / explainers
  /^this \$?\d/i, // "This $48 gadget ..." product pieces
];

const EXCLUDE_LINK = [
  /\/podcasts?\//i,
  /\/opinion\//i,
  /\/video\//i,
  /\/live\//i,
  /\/newsletters?\//i,
  /\/deals?\//i,
  /\/reviews?\/|-review(?:-|\/|$)/i,
];

const STOPWORDS = new Set(
  ('the a an and or of to in on for with at by from as is are was were be been it its this that these those ' +
    'after before over under into about amid says said say will would could can may new more than how why what ' +
    'who when where us u.s. its his her their they them you your our not no but just up out off back first last ' +
    'year years day days week weeks time report reports news amid against while still also').split(' ')
);

function isExcluded(story) {
  return EXCLUDE_TITLE.some((re) => re.test(story.title)) || EXCLUDE_LINK.some((re) => re.test(story.link || ''));
}

function keywords(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9$%\s-]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^-+|-+$/g, ''))
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  );
}

/**
 * Keyword Jaccard similarity. Requires at least 3 shared keywords so short
 * headlines like "Fed holds rates" / "Fed cuts rates" aren't merged.
 */
function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  if (inter < 3) return 0;
  return inter / (a.size + b.size - inter);
}

const SAME_EVENT = 0.3;

/**
 * Score every story in place (adds .score and .coverage).
 * `all` is every candidate across categories, so coverage counts any outlet.
 */
function scoreStories(all) {
  const now = Date.now();
  for (const s of all) s._kw = keywords(s.title);

  for (const s of all) {
    const outlets = new Set();
    for (const o of all) {
      if (o === s || o.source === s.source) continue;
      if (similarity(s._kw, o._kw) >= SAME_EVENT) outlets.add(o.source);
    }
    s.coverage = outlets.size;

    const ageH = s.pubDate ? (now - s.pubDate.getTime()) / 3600000 : 24;
    const recency = Math.max(0, 1.5 - ageH / 16); // 1.5 for fresh, 0 after ~24h
    const rankBonus = s.feedRank != null ? Math.max(0, 1 - s.feedRank / 10) : 0; // feed's own ordering
    const descBonus = s.snippet ? 0.3 : 0;

    s.score = s.coverage * 2 + recency + rankBonus + descBonus;
  }
}

/**
 * Pick `count` top-scoring stories, skipping ones about the same event as an
 * already-picked story.
 */
function pickTop(stories, count, alreadyPicked = []) {
  const picked = [...alreadyPicked];
  const out = [];
  for (const s of [...stories].sort((a, b) => b.score - a.score)) {
    if (out.length >= count) break;
    if (sameEventAsAny(s, picked)) continue;
    picked.push(s);
    out.push(s);
  }
  return out;
}

/** True if `story` covers the same event as any story in `others`. */
function sameEventAsAny(story, others) {
  const kw = story._kw || keywords(story.title);
  return others.some((p) => p.id === story.id || similarity(kw, p._kw || keywords(p.title)) >= SAME_EVENT);
}

module.exports = { isExcluded, scoreStories, pickTop, sameEventAsAny };
