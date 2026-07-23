/**
 * Golf Green Fee Tracker — Frontend Application
 *
 * Loads scraped green fee data and renders interactive charts,
 * trend comparisons, and tee time details.
 */

// ── Configuration ──────────────────────────────────────────────────────────────

const DATA_BASE = './data';
const COURSE_ID = 'montvert';
const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const KRW_SHORT = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

// ── State ──────────────────────────────────────────────────────────────────────

let allSnapshots = {};    // { "2026-06-26": snapshotData, ... }
let dailySummary = {};    // { "20260628": { date, dayOfWeek, avgFee, minFee, maxFee, count }, ... }
let trendChart = null;
let dowChart = null;

// ── Initialization ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  applyFadeIn();
  await loadData();
  renderStats();
  renderTrendChart();
  renderDowChart();
  setupDatePicker();
});

/**
 * Apply fade-in animation to stat cards.
 */
function applyFadeIn() {
  document.querySelectorAll('.stat-card').forEach((el) => el.classList.add('fade-in-up'));
}

// ── Data Loading ───────────────────────────────────────────────────────────────

/**
 * Load index and all snapshot files.
 */
async function loadData() {
  try {
    const indexRes = await fetch(`${DATA_BASE}/index.json`);
    if (!indexRes.ok) throw new Error(`Index fetch failed: ${indexRes.status}`);
    const index = await indexRes.json();

    document.getElementById('last-update').innerHTML = index.lastUpdated
      ? `<span class="pulse-dot"></span><span>Updated: ${formatDateTime(index.lastUpdated)}</span>`
      : `<span class="pulse-dot"></span><span>No data yet</span>`;

    // Load each snapshot
    const snapshotPromises = (index.snapshots || []).map(async (date) => {
      try {
        const res = await fetch(`${DATA_BASE}/${COURSE_ID}/${date}.json`);
        if (res.ok) {
          const data = await res.json();
          allSnapshots[date] = data;
        }
      } catch (e) {
        console.warn(`Failed to load snapshot ${date}:`, e);
      }
    });

    await Promise.all(snapshotPromises);
    console.log(`Loaded ${Object.keys(allSnapshots).length} snapshots`);

    // Build daily summary from latest snapshot
    buildDailySummary();

  } catch (err) {
    console.error('Failed to load data:', err);
    showNoDataState();
  }
}

/**
 * Build a flat daily summary from all snapshots.
 * Uses the latest snapshot for each target date's data.
 */
function buildDailySummary() {
  // Process snapshots in order, later ones overwrite earlier
  const sortedDates = Object.keys(allSnapshots).sort();

  for (const snapDate of sortedDates) {
    const snap = allSnapshots[snapDate];
    if (!snap.dates) continue;

    for (const [dateStr, dateData] of Object.entries(snap.dates)) {
      if (dateData.stats && dateData.stats.count > 0) {
        dailySummary[dateStr] = {
          date: dateStr,
          dayOfWeek: dateData.dayOfWeek,
          avgFee: dateData.stats.avgFee,
          minFee: dateData.stats.minFee,
          maxFee: dateData.stats.maxFee,
          medianFee: dateData.stats.medianFee,
          count: dateData.stats.count,
          teetimes: dateData.teetimes || [],
          snapshotDate: snapDate,
        };
      }
    }
  }

  console.log(`Daily summary contains ${Object.keys(dailySummary).length} dates`);
}

// ── Stats Cards ────────────────────────────────────────────────────────────────

function renderStats() {
  const dates = Object.keys(dailySummary).sort();
  if (dates.length === 0) {
    showNoDataState();
    return;
  }

  // Today's stats (or nearest available date)
  const today = formatDateStr(new Date());
  const todayData = dailySummary[today];
  const nearestDate = findNearestDate(today, dates);
  const nearestData = nearestDate ? dailySummary[nearestDate] : null;

  // Today's avg
  if (todayData) {
    setStatCard('stat-today-avg', KRW.format(todayData.avgFee), `${todayData.count} tee times available`);
  } else if (nearestData) {
    setStatCard('stat-today-avg', KRW.format(nearestData.avgFee),
      `Nearest: ${formatDateDisplay(nearestDate)}`);
  }

  // Cheapest available across all dates
  let cheapest = null;
  let cheapestDate = null;
  for (const d of dates) {
    const data = dailySummary[d];
    if (data.minFee && (!cheapest || data.minFee < cheapest)) {
      cheapest = data.minFee;
      cheapestDate = d;
    }
  }
  if (cheapest) {
    setStatCard('stat-cheapest', KRW.format(cheapest),
      `${formatDateDisplay(cheapestDate)} (${dailySummary[cheapestDate].dayOfWeek})`);
  }

  // 7-day rolling average
  const weeklyAvg = computeRollingAvg(dates, 7);
  if (weeklyAvg !== null) {
    setStatCard('stat-weekly-avg', KRW.format(weeklyAvg), 'Last 7 available dates');
  }

  // 30-day rolling average
  const monthlyAvg = computeRollingAvg(dates, 30);
  if (monthlyAvg !== null) {
    setStatCard('stat-monthly-avg', KRW.format(monthlyAvg), 'Last 30 available dates');
  }
}

function setStatCard(cardId, value, sub) {
  document.getElementById(`${cardId}-value`).textContent = value;
  document.getElementById(`${cardId}-sub`).textContent = sub;
}

function computeRollingAvg(sortedDates, count) {
  const recent = sortedDates.slice(-count);
  if (recent.length === 0) return null;
  const sum = recent.reduce((acc, d) => acc + (dailySummary[d].avgFee || 0), 0);
  return Math.round(sum / recent.length);
}

// ── Trend Chart ────────────────────────────────────────────────────────────────

function renderTrendChart() {
  const dates = Object.keys(dailySummary).sort();
  if (dates.length === 0) return;

  const labels = dates.map((d) => parseDateStr(d));
  const minData = dates.map((d) => dailySummary[d].minFee);
  const avgData = dates.map((d) => dailySummary[d].avgFee);
  const maxData = dates.map((d) => dailySummary[d].maxFee);

  const ctx = document.getElementById('trend-chart').getContext('2d');

  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Max Fee',
          data: maxData,
          borderColor: 'rgba(244, 63, 94, 0.7)',
          backgroundColor: 'rgba(244, 63, 94, 0.05)',
          borderWidth: 1.5,
          fill: '+1',
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
        {
          label: 'Avg Fee',
          data: avgData,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2.5,
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#06b6d4',
        },
        {
          label: 'Min Fee',
          data: minData,
          borderColor: 'rgba(52, 211, 153, 0.7)',
          backgroundColor: 'rgba(52, 211, 153, 0.05)',
          borderWidth: 1.5,
          fill: '-1',
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 12 },
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${KRW.format(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day',
            displayFormats: { day: 'MM/dd' },
          },
          grid: {
            color: 'rgba(255,255,255,0.04)',
            drawBorder: false,
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 },
            maxRotation: 0,
          },
        },
        y: {
          grid: {
            color: 'rgba(255,255,255,0.04)',
            drawBorder: false,
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 },
            callback: (v) => `₩${KRW_SHORT.format(v)}`,
          },
        },
      },
    },
  });
}

// ── Day of Week Chart ──────────────────────────────────────────────────────────

function renderDowChart() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayData = {};
  days.forEach((d) => (dayData[d] = []));

  for (const data of Object.values(dailySummary)) {
    if (data.dayOfWeek && data.avgFee) {
      dayData[data.dayOfWeek].push(data.avgFee);
    }
  }

  const avgByDay = days.map((d) => {
    const fees = dayData[d];
    return fees.length > 0 ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) : 0;
  });

  // Color gradient — weekend days are more expensive (red), weekdays cheaper (green)
  const colors = [
    '#f43f5e', // Sun — most expensive
    '#34d399', // Mon
    '#34d399', // Tue
    '#34d399', // Wed
    '#34d399', // Thu
    '#f59e0b', // Fri — getting expensive
    '#f43f5e', // Sat — most expensive
  ];

  const ctx = document.getElementById('dow-chart').getContext('2d');

  if (dowChart) dowChart.destroy();

  dowChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: 'Avg Green Fee',
          data: avgByDay,
          backgroundColor: colors.map((c) => c + '33'),
          borderColor: colors,
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          callbacks: {
            label: (ctx) => `Avg: ${KRW.format(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 12, weight: '600' },
          },
        },
        y: {
          grid: {
            color: 'rgba(255,255,255,0.04)',
            drawBorder: false,
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 },
            callback: (v) => `₩${KRW_SHORT.format(v)}`,
          },
        },
      },
    },
  });
}

// ── Date Picker & Analysis ─────────────────────────────────────────────────────

function setupDatePicker() {
  const input = document.getElementById('analysis-date');

  // Set default to today or nearest available date
  const dates = Object.keys(dailySummary).sort();
  if (dates.length > 0) {
    const today = formatDateStr(new Date());
    const nearest = findNearestDate(today, dates);
    if (nearest) {
      input.value = `${nearest.slice(0,4)}-${nearest.slice(4,6)}-${nearest.slice(6,8)}`;
      analyzeDate(nearest);
    }
  }

  input.addEventListener('change', (e) => {
    const dateStr = e.target.value.replace(/-/g, '');
    analyzeDate(dateStr);
  });
}

function analyzeDate(dateStr) {
  const data = dailySummary[dateStr];
  const dates = Object.keys(dailySummary).sort();

  // Selected date avg
  if (data) {
    document.getElementById('cmp-selected-value').textContent = KRW.format(data.avgFee);
    renderTeeTimes(data.teetimes, data);
  } else {
    document.getElementById('cmp-selected-value').textContent = 'No data';
    renderTeeTimes([], null);
  }

  // Compare to day before
  const prevDay = shiftDate(dateStr, -1);
  compareAndRender('cmp-prev-day', data, dailySummary[prevDay]);

  // Compare to week ago
  const weekAgo = shiftDate(dateStr, -7);
  compareAndRender('cmp-week-ago', data, dailySummary[weekAgo]);

  // Compare to month ago
  const monthAgo = shiftDate(dateStr, -30);
  compareAndRender('cmp-month-ago', data, dailySummary[monthAgo]);

  // Compare to 7-day average
  const weeklyAvg = computeRollingAvgAround(dateStr, 7);
  compareToAvg('cmp-weekly-avg', data, weeklyAvg);

  // Compare to 30-day average
  const monthlyAvg = computeRollingAvgAround(dateStr, 30);
  compareToAvg('cmp-monthly-avg', data, monthlyAvg);
}

function compareAndRender(elementId, currentData, compareData) {
  const valueEl = document.getElementById(`${elementId}-value`);
  const badgeEl = document.getElementById(`${elementId}-badge`);

  if (!compareData) {
    valueEl.textContent = 'No data';
    badgeEl.textContent = '';
    badgeEl.className = 'cmp-badge';
    return;
  }

  valueEl.textContent = KRW.format(compareData.avgFee);

  if (!currentData) {
    badgeEl.textContent = '';
    badgeEl.className = 'cmp-badge';
    return;
  }

  const diff = currentData.avgFee - compareData.avgFee;
  const pct = ((diff / compareData.avgFee) * 100).toFixed(1);

  if (diff > 0) {
    badgeEl.textContent = `▲ ${KRW_SHORT.format(Math.abs(diff))} (+${pct}%)`;
    badgeEl.className = 'cmp-badge expensive';
  } else if (diff < 0) {
    badgeEl.textContent = `▼ ${KRW_SHORT.format(Math.abs(diff))} (${pct}%)`;
    badgeEl.className = 'cmp-badge cheaper';
  } else {
    badgeEl.textContent = 'Same price';
    badgeEl.className = 'cmp-badge same';
  }
}

function compareToAvg(elementId, currentData, avg) {
  const valueEl = document.getElementById(`${elementId}-value`);
  const badgeEl = document.getElementById(`${elementId}-badge`);

  if (avg === null) {
    valueEl.textContent = 'No data';
    badgeEl.textContent = '';
    badgeEl.className = 'cmp-badge';
    return;
  }

  valueEl.textContent = KRW.format(avg);

  if (!currentData) {
    badgeEl.textContent = '';
    badgeEl.className = 'cmp-badge';
    return;
  }

  const diff = currentData.avgFee - avg;
  const pct = ((diff / avg) * 100).toFixed(1);

  if (diff > 0) {
    badgeEl.textContent = `▲ ${KRW_SHORT.format(Math.abs(diff))} (+${pct}%)`;
    badgeEl.className = 'cmp-badge expensive';
  } else if (diff < 0) {
    badgeEl.textContent = `▼ ${KRW_SHORT.format(Math.abs(diff))} (${pct}%)`;
    badgeEl.className = 'cmp-badge cheaper';
  } else {
    badgeEl.textContent = 'Same as average';
    badgeEl.className = 'cmp-badge same';
  }
}

function computeRollingAvgAround(dateStr, windowDays) {
  const targetDate = parseDateStr(dateStr);
  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - windowDays);

  let sum = 0;
  let count = 0;

  for (const [d, data] of Object.entries(dailySummary)) {
    const dDate = parseDateStr(d);
    if (dDate >= startDate && dDate <= targetDate && data.avgFee) {
      sum += data.avgFee;
      count++;
    }
  }

  return count > 0 ? Math.round(sum / count) : null;
}

// ── Tee Times Table ────────────────────────────────────────────────────────────

function renderTeeTimes(teetimes, dateData) {
  const tbody = document.getElementById('teetimes-tbody');

  if (!teetimes || teetimes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No tee times available for this date</td></tr>';
    return;
  }

  // Determine fee percentiles for coloring
  const fees = teetimes.map((t) => t.fee).filter((f) => f > 0);
  const minFee = Math.min(...fees);
  const maxFee = Math.max(...fees);
  const range = maxFee - minFee;

  tbody.innerHTML = teetimes
    .map((tt) => {
      let feeClass = 'fee-mid';
      if (range > 0 && tt.fee) {
        const ratio = (tt.fee - minFee) / range;
        if (ratio <= 0.33) feeClass = 'fee-cheap';
        else if (ratio >= 0.67) feeClass = 'fee-expensive';
      }

      return `<tr>
        <td>${escapeHtml(tt.course)}</td>
        <td><strong>${escapeHtml(tt.time)}</strong></td>
        <td>${tt.holes}홀</td>
        <td class="fee-cell ${feeClass}">${tt.fee ? KRW.format(tt.fee) : '—'}</td>
        <td>${tt.event ? escapeHtml(tt.event) : '—'}</td>
      </tr>`;
    })
    .join('');
}

// ── Utility Functions ──────────────────────────────────────────────────────────

/**
 * Format YYYYMMDD to Date object.
 */
function parseDateStr(dateStr) {
  const y = parseInt(dateStr.substring(0, 4));
  const m = parseInt(dateStr.substring(4, 6)) - 1;
  const d = parseInt(dateStr.substring(6, 8));
  return new Date(y, m, d);
}

/**
 * Format Date to YYYYMMDD.
 */
function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Format YYYYMMDD for display (e.g., "Jun 28").
 */
function formatDateDisplay(dateStr) {
  const date = parseDateStr(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format ISO datetime for display.
 */
function formatDateTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Shift a YYYYMMDD date by N days.
 */
function shiftDate(dateStr, days) {
  const date = parseDateStr(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateStr(date);
}

/**
 * Find the nearest date to target in sorted dates array.
 */
function findNearestDate(target, sortedDates) {
  if (sortedDates.includes(target)) return target;

  let nearest = null;
  let minDiff = Infinity;

  for (const d of sortedDates) {
    const diff = Math.abs(parseDateStr(d) - parseDateStr(target));
    if (diff < minDiff) {
      minDiff = diff;
      nearest = d;
    }
  }

  return nearest;
}

/**
 * Escape HTML entities.
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show a "no data" placeholder throughout the dashboard.
 */
function showNoDataState() {
  const mainEl = document.getElementById('app-main');
  mainEl.innerHTML = `
    <div class="no-data-state" style="min-height: 60vh;">
      <div class="icon">⛳</div>
      <h2 style="margin-bottom: 0.5rem;">No Data Yet</h2>
      <p>The scraper hasn't collected any green fee data yet.
         Run the scraper manually or wait for the next scheduled run.</p>
      <p style="margin-top: 1rem; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">
        cd scraper && npm run scrape
      </p>
    </div>
  `;
}
