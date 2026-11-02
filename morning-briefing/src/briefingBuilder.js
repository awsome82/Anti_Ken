const config = require('./config');

/**
 * Escape HTML special characters for Telegram HTML mode.
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format Date string in Korean.
 * Example: 2026년 7월 23일 (목요일)
 */
function getFormattedDateKorean() {
  const now = new Date();
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const dayName = days[now.getDay()];
  return `${y}년 ${m}월 ${d}일 (${dayName})`;
}

/**
 * Build a complete Korean Telegram HTML morning briefing message.
 */
function buildBriefing(marketData, news) {
  const dateStr = getFormattedDateKorean();

  let msg = `🌅 <b>미국 증시 & 주요 뉴스 모닝 브리핑</b>\n`;
  msg += `📅 <i>${dateStr}</i>\n\n`;

  // 1. Market Indices Section (한국어)
  msg += `📊 <b>미국 주요 지수</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

  if (marketData.indices && marketData.indices.length > 0) {
    for (const idx of marketData.indices) {
      if (idx.error) continue;
      const emoji = idx.isUp ? '🟢' : '🔴';
      msg += `${emoji} <b>${escapeHtml(idx.name)}</b>: ${idx.formattedPrice} (${idx.formattedPercent})\n`;
    }
  }
  msg += `\n`;

  // 2. Key Stock Equities Section
  msg += `💼 <b>주요 종목 현황</b>\n`;
  if (marketData.equities && marketData.equities.length > 0) {
    const stockLines = marketData.equities
      .filter((e) => !e.error)
      .map((e) => {
        const emoji = e.isUp ? '🟢' : '🔴';
        return `${emoji} <b>${e.symbol}</b>: $${e.formattedPrice} (${e.formattedPercent})`;
      });

    // Group into 2 columns
    for (let i = 0; i < stockLines.length; i += 2) {
      if (i + 1 < stockLines.length) {
        msg += `${stockLines[i]}  |  ${stockLines[i + 1]}\n`;
      } else {
        msg += `${stockLines[i]}\n`;
      }
    }
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 3. Category News (일반 / 경제 / IT)
  msg += `📰 <b>미국 분야별 핵심 뉴스</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

  const categories = news?.categories || [];
  const hasStories = categories.some((c) => c.stories.length > 0);
  if (!hasStories) {
    msg += `<i>수집된 주요 뉴스 업데이트가 없습니다.</i>\n\n`;
  } else {
    for (const cat of categories) {
      if (cat.stories.length === 0) continue;
      msg += `\n${cat.emoji} <b>${escapeHtml(cat.label)}</b>\n`;
      cat.stories.forEach((item, index) => {
        msg += `${index + 1}. <b>${escapeHtml(item.titleKo || item.title)}</b>\n`;
        if (item.summaryKo) {
          msg += `${escapeHtml(item.summaryKo)}\n`;
        }
        msg += `↳ 출처: <a href="${escapeHtml(item.link)}">${escapeHtml(item.source)}</a>\n`;
      });
    }
    msg += `\n`;
  }

  // 4. Korean Market Takeaway Digest
  msg += `💡 <b>시장 요약 & 전망</b>\n`;
  const sp500 = marketData.indices?.find((i) => i.symbol === '^GSPC');
  const nasdaq = marketData.indices?.find((i) => i.symbol === '^IXIC');

  if (sp500 && nasdaq && !sp500.error) {
    if (sp500.isUp && nasdaq.isUp) {
      msg += `어젯밤 미국 증시는 기술주 강세와 시장 매수세에 힘입어 주요 지수가 동반 상승 마감했습니다.`;
    } else if (!sp500.isUp && !nasdaq.isUp) {
      msg += `어젯밤 미국 증시는 거시경제 우려 및 매도세 영향으로 하락 마감했습니다.`;
    } else {
      msg += `어젯밤 미국 증시는 기업 실적 발표와 경제 지표 속에 혼조세로 마감했습니다.`;
    }
  } else {
    msg += `오늘 개장 전 최신 경제 지표와 시장 동향을 주시하세요.`;
  }

  const summaryNote = news?.method === 'claude' ? ' · 뉴스 선별·요약: Claude' : ' · 뉴스: 자동 번역';
  msg += `\n\n🤖 <i>자동 모닝 브리핑 봇${summaryNote}</i>`;

  return msg;
}

module.exports = { buildBriefing };
