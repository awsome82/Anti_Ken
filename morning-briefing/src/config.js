require('dotenv').config();

const GOOGLE_NEWS_TOPIC = (topic) =>
  `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-US&gl=US&ceid=US:en`;

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  // When true, print the briefing instead of sending it to Telegram.
  dryRun: /^(1|true|yes)$/i.test(process.env.DRY_RUN || ''),
  stocks: {
    indices: (process.env.INDICES || '^GSPC,^IXIC,^DJI').split(',').map((s) => s.trim()),
    equities: (process.env.EQUITIES || 'NVDA,AAPL,MSFT,TSLA,GOOGL,AMZN,NTAP').split(',').map((s) => s.trim()),
  },
  timezone: process.env.TIMEZONE || 'Asia/Seoul',

  // Optional, paid: Claude picks the stories and writes Korean summaries.
  // Takes priority over GitHub Models when ANTHROPIC_API_KEY is set.
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    effort: process.env.CLAUDE_EFFORT || 'medium',
  },

  // Free AI via GitHub Models (uses the Actions GITHUB_TOKEN with
  // `models: read`). Models are tried in order until one works.
  githubModels: {
    token: process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN || '',
    models: (process.env.GITHUB_MODELS || 'openai/gpt-4.1-mini,openai/gpt-4o-mini')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxCandidates: 20, // per category; keeps each request under the free-tier input cap
  },

  news: {
    perCategory: 3, // stories shown per category
    perFeed: 10, // candidates read from each feed
    maxAgeHours: 36, // ignore stories older than this
  },

  // News categories, in display order. Each category pulls candidates from
  // several feeds so the selection isn't dominated by one outlet.
  newsCategories: [
    {
      id: 'general',
      label: '일반',
      emoji: '🇺🇸',
      feeds: [
        { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
        { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
        { name: 'Google News', url: GOOGLE_NEWS_TOPIC('NATION'), aggregator: true },
      ],
    },
    {
      id: 'economy',
      label: '경제',
      emoji: '💵',
      feeds: [
        { name: 'CNBC', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
        { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
        { name: 'WSJ', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
        { name: 'Google News', url: GOOGLE_NEWS_TOPIC('BUSINESS'), aggregator: true },
      ],
    },
    {
      id: 'tech',
      label: 'IT',
      emoji: '💻',
      feeds: [
        { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
        { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
        { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
        { name: 'Google News', url: GOOGLE_NEWS_TOPIC('TECHNOLOGY'), aggregator: true },
      ],
    },
  ],
};

module.exports = config;
