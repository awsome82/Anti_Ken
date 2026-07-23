const { fetchMarketData } = require('./stockFetcher');
const { fetchNews } = require('./newsFetcher');
const { buildBriefing } = require('./briefingBuilder');
const { sendTelegramMessage } = require('./telegramSender');

async function main() {
  const startTime = Date.now();
  console.log('=== US Morning Briefing Telegram Bot ===');
  console.log(`Started execution at: ${new Date().toISOString()}\n`);

  try {
    // Step 1: Fetch stock market quotes & indices concurrently
    const marketDataPromise = fetchMarketData();

    // Step 2: Fetch major US news headlines concurrently
    const newsPromise = fetchNews(5, 8);

    const [marketData, newsItems] = await Promise.all([marketDataPromise, newsPromise]);

    // Step 3: Render briefing message
    const briefingHtml = buildBriefing(marketData, newsItems);

    // Step 4: Deliver briefing (Telegram API or Console Preview)
    await sendTelegramMessage(briefingHtml);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== Completed Morning Briefing workflow in ${elapsed}s ===`);
  } catch (err) {
    console.error('[FATAL ERROR] Morning Briefing workflow failed:', err);
    process.exit(1);
  }
}

main();
