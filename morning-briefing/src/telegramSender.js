const axios = require('axios');
const config = require('./config');

/**
 * Strip HTML tags for clean console terminal display.
 */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '');
}

/**
 * Send a message via Telegram Bot API or fall back to Console Preview Mode.
 */
async function sendTelegramMessage(messageHtml) {
  const token = config.telegram.token;
  const chatId = config.telegram.chatId;

  const isConfigured = token && chatId && token !== 'your_bot_token' && chatId !== 'your_chat_id';

  if (!isConfigured) {
    console.log('\n===============================================================');
    console.log('📌 [NOTICE] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env.');
    console.log('📌 [NOTICE] Displaying formatted Morning Briefing in CONSOLE PREVIEW MODE:');
    console.log('===============================================================\n');
    console.log(stripHtml(messageHtml));
    console.log('\n===============================================================');
    console.log('💡 To receive this briefing on Telegram:');
    console.log('   1. Create a bot via Telegram @BotFather to get your token.');
    console.log('   2. Get your Chat ID via @userinfobot or channel handle.');
    console.log('   3. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in morning-briefing/.env');
    console.log('===============================================================\n');
    return { success: true, mode: 'preview' };
  }

  console.log(`[TELEGRAM] Sending Morning Briefing to Chat ID (${chatId})...`);

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    // Handle max message length (4096 chars)
    if (messageHtml.length > 4000) {
      const parts = chunkMessage(messageHtml, 3800);
      for (let i = 0; i < parts.length; i++) {
        await axios.post(url, {
          chat_id: chatId,
          text: parts[i],
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      }
    } else {
      await axios.post(url, {
        chat_id: chatId,
        text: messageHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }

    console.log('[TELEGRAM] ✅ Morning Briefing successfully sent to Telegram!');
    return { success: true, mode: 'telegram' };
  } catch (err) {
    const errorDetails = err.response?.data?.description || err.message;
    console.error('[TELEGRAM ERROR] Failed to send Telegram message:', errorDetails);

    console.log('\n--- Console Fallback Display ---');
    console.log(stripHtml(messageHtml));
    return { success: false, error: errorDetails };
  }
}

/**
 * Split large messages into chunks at line breaks.
 */
function chunkMessage(text, maxLen) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if ((current + line + '\n').length > maxLen) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}

module.exports = { sendTelegramMessage };
