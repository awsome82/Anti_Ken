const Parser = require('rss-parser');
const axios = require('axios');
const config = require('./config');

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

/**
 * Clean headline title text (strip HTML tags, extra whitespace, source tags).
 */
function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/<[^>]*>/g, '')
    .replace(/\s*-\s*[A-Za-z0-9\s]+$/, '') // Remove trailing "- Source"
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Translate English headline text to natural Korean.
 */
async function translateToKorean(text) {
  if (!text) return '';
  try {
    const safeText = text.replace(/\$/g, ' USD ');
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(
      safeText
    )}`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 4000,
    });
    if (res.data && res.data[0]) {
      const translated = res.data[0]
        .map((x) => x[0])
        .join('')
        .trim();
      return translated || text;
    }
    return text;
  } catch (err) {
    console.warn(`[TRANSLATE WARNING] Failed to translate title:`, err.message);
    return text;
  }
}

/**
 * Fetch and aggregate news from configured RSS feeds, translated into Korean.
 */
async function fetchNews(limitPerSource = 5, totalMax = 3) {
  console.log('[NEWS] Fetching overnight major US news headlines...');
  const allItems = [];
  const seenTitles = new Set();

  const fetchPromises = config.newsFeeds.map(async (feedInfo) => {
    try {
      const feed = await parser.parseURL(feedInfo.url);
      const items = feed.items || [];
      const extracted = [];

      for (const item of items.slice(0, limitPerSource)) {
        const cleaned = cleanTitle(item.title);
        const normalized = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (!cleaned || normalized.length < 15 || seenTitles.has(normalized)) {
          continue;
        }

        seenTitles.add(normalized);
        extracted.push({
          titleOriginal: cleaned,
          title: cleaned,
          link: item.link || feedInfo.url,
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
          source: feedInfo.name,
          category: feedInfo.category,
        });
      }

      return extracted;
    } catch (err) {
      console.warn(`[NEWS WARNING] Failed to fetch feed (${feedInfo.name}):`, err.message);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  results.forEach((items) => allItems.push(...items));

  // Sort by pubDate descending
  allItems.sort((a, b) => b.pubDate - a.pubDate);

  const topNews = allItems.slice(0, totalMax);

  // Translate top news titles to Korean concurrently
  console.log(`[NEWS] Translating top ${topNews.length} news headlines to Korean...`);
  await Promise.all(
    topNews.map(async (item) => {
      item.titleKo = await translateToKorean(item.titleOriginal);
    })
  );

  console.log(`[NEWS] Collected and translated ${topNews.length} top news stories.`);
  return topNews;
}

module.exports = { fetchNews };
