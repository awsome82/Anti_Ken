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
function buildBriefing(marketData, newsItems) {
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

  // 2. Key Stock Equities Section (한국어 + NTAP 포함)
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

  // 3. Top 3 Overnight Major News (한국어 라벨)
  const top3News = (newsItems || []).slice(0, 3);
  msg += `📰 <b>밤사이 핵심 미국 뉴스 (Top 3)</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

  if (top3News.length === 0) {
    msg += `<i>수집된 주요 뉴스 업데이트가 없습니다.</i>\n`;
  } else {
    top3News.forEach((item, index) => {
      const cleanT = escapeHtml(item.titleKo || item.title);
      const cleanS = escapeHtml(item.source);
      msg += `${index + 1}. <a href="${item.link}"><b>${cleanT}</b></a>\n`;
      if (item.snippetKo) {
        const cleanSnip = escapeHtml(item.snippetKo);
        msg += `   📝 <i>요약: ${cleanSnip}</i>\n`;
      }
      msg += `   ↳ <i>출처: ${cleanS}</i>\n\n`;
    });
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

  msg += `\n\n🤖 <i>자동 모닝 브리핑 봇</i>`;

  return msg;
}

module.exports = { buildBriefing };
