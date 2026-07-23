require('dotenv').config();

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  stocks: {
    indices: (process.env.INDICES || '^GSPC,^IXIC,^DJI').split(',').map((s) => s.trim()),
    equities: (process.env.EQUITIES || 'NVDA,AAPL,MSFT,TSLA,GOOGL,AMZN,NTAP').split(',').map((s) => s.trim()),
  },
  timezone: process.env.TIMEZONE || 'Asia/Seoul',
  newsFeeds: [
    {
      name: 'Google News (US Top Stories)',
      url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
      category: 'Top US Headlines',
    },
    {
      name: 'Yahoo Finance Top News',
      url: 'https://finance.yahoo.com/news/rssindex',
      category: 'Markets & Finance',
    },
    {
      name: 'WSJ Markets',
      url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
      category: 'Wall Street Journal',
    },
    {
      name: 'CNBC Business',
      url: 'https://search.cnbc.com/rs/search/combined/server/settings/search.rss?partnerId=2000&keywords=market',
      category: 'CNBC Markets',
    },
  ],
};

module.exports = config;
