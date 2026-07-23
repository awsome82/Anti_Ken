const axios = require('axios');
const config = require('./config');

const INDEX_NAMES = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'Nasdaq',
  '^DJI': 'Dow Jones',
  '^RUT': 'Russell 2000',
  '^VIX': 'VIX Volatility',
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch market quote data for a single ticker symbol.
 */
async function fetchTicker(symbol) {
  try {
    const encoded = encodeURIComponent(symbol);
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=2d`;
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 6000,
    });

    const result = res.data?.chart?.result?.[0];
    if (!result || !result.meta) {
      throw new Error('Invalid response structure');
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? 0;
    const prevClose = meta.chartPreviousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

    const displayName = INDEX_NAMES[symbol] || meta.shortName || meta.symbol || symbol;

    return {
      symbol,
      name: displayName,
      price,
      change,
      changePercent,
      isUp: change >= 0,
      formattedPrice:
        price >= 1000
          ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : price.toFixed(2),
      formattedChange: (change >= 0 ? '+' : '') + change.toFixed(2),
      formattedPercent: (change >= 0 ? '+' : '') + changePercent.toFixed(2) + '%',
    };
  } catch (err) {
    console.warn(`[STOCK WARNING] Failed to fetch quote for ${symbol}:`, err.message);
    return createFallbackQuote(symbol);
  }
}

/**
 * Fetch all configured market indices and equity stock quotes sequentially with small delays.
 */
async function fetchMarketData() {
  console.log('[STOCKS] Fetching stock market quotes & indices...');

  const indices = [];
  for (const sym of config.stocks.indices) {
    const quote = await fetchTicker(sym);
    indices.push(quote);
    await sleep(150);
  }

  const equities = [];
  for (const sym of config.stocks.equities) {
    const quote = await fetchTicker(sym);
    equities.push(quote);
    await sleep(150);
  }

  console.log(`[STOCKS] Retreived ${indices.length} market indices and ${equities.length} equities successfully.`);
  return { indices, equities };
}

function createFallbackQuote(symbol) {
  return {
    symbol,
    name: INDEX_NAMES[symbol] || symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    isUp: true,
    formattedPrice: 'N/A',
    formattedChange: '0.00',
    formattedPercent: '0.00%',
    error: true,
  };
}

module.exports = { fetchMarketData };


