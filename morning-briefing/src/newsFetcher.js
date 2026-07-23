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
 * Clean headline title & snippet text.
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s*-\s*[A-Za-z0-9\s]+$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Enhanced financial translation engine for English to Korean.
 */
async function translateToKorean(text) {
  if (!text || text.length < 5) return '';
  try {
    let clean = cleanText(text);

    // Pre-processing financial terminology
    clean = clean.replace(/First Look:\s*/gi, '[실적 속보] ');
    clean = clean.replace(/First Look\s*/gi, '[실적 속보] ');
    clean = clean.replace(/\bCapex\b/gi, '설비투자');
    clean = clean.replace(/\bEarnings\b/gi, '실적');
    clean = clean.replace(/\$(\d+(\.\d+)?)\s*B\b/gi, '$10억 달러');
    clean = clean.replace(/\$(\d+(\.\d+)?)\s*M\b/gi, '$100만 달러');
    clean = clean.replace(/\$(\d+(\.\d+)?)/g, '$1 달러');

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(
      clean
    )}`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000,
    });

    if (res.data && res.data[0]) {
      let ko = res.data[0]
        .map((x) => x[0])
        .join('')
        .trim();

      // Post-processing cleanup for financial accuracy
      ko = ko
        .replace(/Waters 사업/g, '생수 사업부')
        .replace(/첫눈:\s*/g, '[실적 속보] ')
        .replace(/첫 인상:\s*/g, '[실적 속보] ')
        .replace(/식물투자/g, '설비투자')
        .replace(/조명투자/g, '설비투자')
        .replace(/\s+/g, ' ')
        .trim();

      return ko || text;
    }
    return text;
  } catch (err) {
    console.warn(`[TRANSLATE WARNING] Failed to translate:`, err.message);
    return text;
  }
}

/**
 * Fetch and aggregate news from configured RSS feeds, translated into Korean with summaries.
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
        const cleanedTitle = cleanText(item.title);
        const snippet = cleanText(item.contentSnippet || item.summary || item.content || '');
        const normalized = cleanedTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (!cleanedTitle || normalized.length < 15 || seenTitles.has(normalized)) {
          continue;
        }

        seenTitles.add(normalized);
        extracted.push({
          titleOriginal: cleanedTitle,
          snippetOriginal: snippet.length > 20 && snippet !== cleanedTitle ? snippet.slice(0, 200) : '',
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

  // Translate top news titles & snippets to Korean concurrently
  console.log(`[NEWS] Translating top ${topNews.length} news headlines & summaries to Korean...`);
  await Promise.all(
    topNews.map(async (item) => {
      item.titleKo = await translateToKorean(item.titleOriginal);
      if (item.snippetOriginal) {
        item.snippetKo = await translateToKorean(item.snippetOriginal);
      }
    })
  );

  console.log(`[NEWS] Collected and translated ${topNews.length} top news stories.`);
  return topNews;
}

module.exports = { fetchNews };
