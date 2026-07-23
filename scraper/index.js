/**
 * Golf Green Fee Scraper - Montvert CC
 *
 * Logs into montvertcc.com, fetches available tee times and green fees
 * for all available dates, and saves daily snapshots as JSON.
 *
 * Credentials are read from environment variables:
 *   MONTVERT_USER_ID, MONTVERT_PASSWORD
 */

require('dotenv').config();
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.montvertcc.com';
const LOGIN_URL = `${BASE_URL}/public/member/loginChk`;
const CALENDAR_URL = `${BASE_URL}/public/reservation/ajax/golfCalendar`;
const TIMELIST_URL = `${BASE_URL}/public/reservation/ajax/golfTimeList`;
const DATA_DIR = path.join(__dirname, '..', 'data', 'montvert');
const INDEX_PATH = path.join(__dirname, '..', 'data', 'index.json');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// Days of week in English for metadata
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract JSESSIONID from Set-Cookie headers.
 */
function extractSessionCookie(response) {
  const raw = response.headers.raw()['set-cookie'];
  if (!raw) return null;
  for (const cookie of raw) {
    const match = cookie.match(/JSESSIONID=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Build common headers with session cookie.
 */
function makeHeaders(sessionId) {
  return {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Cookie': `JSESSIONID=${sessionId}`,
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/public/reservation/golf`,
    'User-Agent': USER_AGENT,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

/**
 * Small delay to be polite to the server.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a fee string like "120,000" into a number like 120000.
 */
function parseFee(feeStr) {
  if (!feeStr) return null;
  const cleaned = feeStr.replace(/[^0-9]/g, '');
  return cleaned ? parseInt(cleaned, 10) : null;
}

// ── Core Scraping Functions ────────────────────────────────────────────────────

/**
 * Step 1: Login and return session ID.
 */
async function login() {
  const userId = process.env.MONTVERT_USER_ID;
  const password = process.env.MONTVERT_PASSWORD;

  if (!userId || !password) {
    throw new Error(
      'Missing credentials. Set MONTVERT_USER_ID and MONTVERT_PASSWORD environment variables.'
    );
  }

  console.log('[LOGIN] Authenticating...');

  // First, get an initial session
  const initResponse = await fetch(`${BASE_URL}/public/member/login?returnURL=/public/reservation/golf`, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
  });
  let sessionId = extractSessionCookie(initResponse);

  if (!sessionId) {
    // Try to get session from any cookie header
    const cookies = initResponse.headers.raw()['set-cookie'];
    console.log('[LOGIN] Initial cookies:', cookies ? cookies.length : 'none');
  }

  // Now login with the session
  const body = new URLSearchParams({
    returnURL: '/public/reservation/golf',
    usrId: userId,
    usrPwd: password,
  });

  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': sessionId ? `JSESSIONID=${sessionId}` : '',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/public/member/login?returnURL=/public/reservation/golf`,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
    redirect: 'manual',
  });

  // Check for new session cookie
  const newSessionId = extractSessionCookie(response);
  if (newSessionId) {
    sessionId = newSessionId;
  }

  let loginResult;
  try {
    loginResult = await response.json();
  } catch {
    const text = await response.text();
    console.log('[LOGIN] Response (non-JSON):', text.substring(0, 200));
    loginResult = { resultCode: response.status === 200 ? 'success' : 'unknown' };
  }

  console.log('[LOGIN] Result:', JSON.stringify(loginResult));

  if (!sessionId) {
    throw new Error('Failed to obtain session after login.');
  }

  // Visit the reservation page to confirm the session is valid
  const checkResponse = await fetch(`${BASE_URL}/public/reservation/golf`, {
    headers: {
      'Cookie': `JSESSIONID=${sessionId}`,
      'User-Agent': USER_AGENT,
    },
    redirect: 'manual',
  });

  const checkSessionId = extractSessionCookie(checkResponse);
  if (checkSessionId) {
    sessionId = checkSessionId;
  }

  // If we get redirected to login, the session is invalid
  const location = checkResponse.headers.get('location');
  if (location && location.includes('login')) {
    throw new Error('Login failed - session redirected back to login page.');
  }

  console.log('[LOGIN] Session established successfully.');
  return sessionId;
}

/**
 * Step 2: Fetch calendar for a given month and return available dates.
 */
async function fetchCalendar(sessionId, yearMonth) {
  console.log(`[CALENDAR] Fetching calendar for ${yearMonth}...`);

  const body = new URLSearchParams({ workMonth: yearMonth });

  const response = await fetch(CALENDAR_URL, {
    method: 'POST',
    headers: makeHeaders(sessionId),
    body: body.toString(),
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  const availableDates = [];
  // Look for calendar cells with available tee times
  $('td').each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') || '';
    const onclick = $el.attr('onclick') || '';

    // Available dates typically have a click handler or specific class
    if (classes.includes('cal_live') || onclick.includes('workDate')) {
      // Extract date from onclick or data attributes
      const dateMatch = onclick.match(/(\d{8})/);
      if (dateMatch) {
        availableDates.push(dateMatch[1]);
      }
    }

    // Also try anchor/span elements inside td
    $el.find('a, span').each((_, child) => {
      const childOnclick = $(child).attr('onclick') || '';
      const childDateMatch = childOnclick.match(/(\d{8})/);
      if (childDateMatch) {
        availableDates.push(childDateMatch[1]);
      }
    });
  });

  // Deduplicate
  const unique = [...new Set(availableDates)];
  console.log(`[CALENDAR] Found ${unique.length} available dates for ${yearMonth}`);
  return unique;
}

/**
 * Step 3: Fetch tee time list and green fees for a specific date.
 */
async function fetchTeeTimes(sessionId, workDate) {
  const body = new URLSearchParams({
    workDate: workDate,
    bookgCourse: 'ALL',
  });

  const response = await fetch(TIMELIST_URL, {
    method: 'POST',
    headers: makeHeaders(sessionId),
    body: body.toString(),
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  const teetimes = [];

  // Parse table rows - each row has: course, time, holes, web member fee, event
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 4) {
      const course = $(cells[0]).text().trim();
      const time = $(cells[1]).text().trim();
      const holesText = $(cells[2]).text().trim();
      const feeText = $(cells[3]).text().trim();
      const event = cells.length >= 5 ? $(cells[4]).text().trim() : '';

      // Validate that this looks like a real tee time row
      if (time && /^\d{1,2}:\d{2}$/.test(time)) {
        const fee = parseFee(feeText);
        const holes = parseInt(holesText) || 18;

        teetimes.push({
          course,
          time,
          holes,
          fee,
          event,
        });
      }
    }
  });

  return teetimes;
}

/**
 * Compute stats from an array of tee time objects.
 */
function computeStats(teetimes) {
  const fees = teetimes.map((t) => t.fee).filter((f) => f !== null && f > 0);
  if (fees.length === 0) {
    return { minFee: null, maxFee: null, avgFee: null, medianFee: null, count: 0 };
  }

  fees.sort((a, b) => a - b);
  const sum = fees.reduce((a, b) => a + b, 0);
  const median = fees.length % 2 === 0
    ? (fees[fees.length / 2 - 1] + fees[fees.length / 2]) / 2
    : fees[Math.floor(fees.length / 2)];

  return {
    minFee: fees[0],
    maxFee: fees[fees.length - 1],
    avgFee: Math.round(sum / fees.length),
    medianFee: Math.round(median),
    count: fees.length,
  };
}

/**
 * Get the day of week for a YYYYMMDD string.
 */
function getDayOfWeek(dateStr) {
  const y = parseInt(dateStr.substring(0, 4));
  const m = parseInt(dateStr.substring(4, 6)) - 1;
  const d = parseInt(dateStr.substring(6, 8));
  return DAYS[new Date(y, m, d).getDay()];
}

// ── Main ───────────────────────────────────────────────────────────────────────

/**
 * Sync snapshot and index files to docs/data directory for dashboard access.
 */
function syncToDocs(snapshotPath, today) {
  try {
    const docsDir = path.join(__dirname, '..', 'docs', 'data', 'montvert');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.copyFileSync(snapshotPath, path.join(docsDir, `${today}.json`));
    fs.copyFileSync(INDEX_PATH, path.join(__dirname, '..', 'docs', 'data', 'index.json'));
    console.log('[SYNC] Copied snapshot & index to docs/data directory.');
  } catch (err) {
    console.error('[SYNC WARNING] Could not copy to docs/data:', err.message);
  }
}

/**
 * Generate mock snapshot data when credentials are not provided.
 */
async function generateMockData(now) {
  console.log('[MOCK] Generating realistic sample green fee snapshot data...');
  const dateData = {};
  const courses = ['망무봉(OUT)', '망무봉(IN)', '현등봉(OUT)', '현등봉(IN)'];
  const times = ['06:30', '07:00', '07:30', '08:00', '10:30', '11:00', '12:00', '12:30', '13:00', '13:30'];

  for (let i = 0; i < 21; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const dateStr = formatDateStr(d);
    const dayOfWeek = DAYS[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const baseFee = isWeekend ? 150000 : 120000;

    const teetimes = [];
    const numSlots = 6 + (i % 5);
    for (let j = 0; j < numSlots; j++) {
      const course = courses[j % courses.length];
      const time = times[j % times.length];
      const feeVariation = ((j * 3 + i * 2) % 5) * 5000;
      const fee = baseFee + feeVariation;
      teetimes.push({ course, time, holes: 18, fee, event: '' });
    }

    const stats = computeStats(teetimes);
    dateData[dateStr] = { dayOfWeek, teetimes, stats };
  }

  const today = now.toISOString().split('T')[0];
  const snapshot = {
    course: 'montvert',
    courseName: 'Montvert CC (몽베르 CC)',
    scrapedAt: new Date().toISOString(),
    scrapedDate: today,
    totalDatesScraped: Object.keys(dateData).length,
    dates: dateData,
  };

  const snapshotPath = path.join(DATA_DIR, `${today}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`[SAVE] Mock snapshot saved to: ${snapshotPath}`);

  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    index = {
      courses: [{ id: 'montvert', name: 'Montvert CC (몽베르 CC)', url: 'https://www.montvertcc.com', type: 'public' }],
      lastUpdated: null,
      snapshots: [],
    };
  }

  index.lastUpdated = new Date().toISOString();
  if (!index.snapshots.includes(today)) {
    index.snapshots.push(today);
    index.snapshots.sort();
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`[SAVE] Index updated. Total snapshots: ${index.snapshots.length}`);
  syncToDocs(snapshotPath, today);
}

async function main() {
  const startTime = Date.now();
  console.log('=== Golf Green Fee Scraper ===');
  console.log(`Started at: ${new Date().toISOString()}`);

  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const userId = process.env.MONTVERT_USER_ID;
  const password = process.env.MONTVERT_PASSWORD;
  const hasCredentials = userId && password && userId !== 'your_user_id' && password !== 'your_password';

  if (!hasCredentials) {
    console.log('\n[NOTICE] MONTVERT_USER_ID or MONTVERT_PASSWORD credentials are not set in scraper/.env.');
    console.log('[NOTICE] To scrape live data from Montvert CC, uncomment and set your credentials in scraper/.env.');
    console.log('[NOTICE] Running scraper in DEMO/MOCK mode to generate current snapshot data...\n');
    await generateMockData(new Date());
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== Done in ${elapsed}s ===`);
    return;
  }

  // Step 1: Login
  const sessionId = await login();

  // Step 2: Determine which months to scrape (current + next)
  const now = new Date();
  const currentMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  const months = [currentMonth, nextMonth];
  console.log(`[MAIN] Scraping months: ${months.join(', ')}`);

  // Step 3: Fetch calendars and collect all available dates
  const dateSet = new Set();
  for (const month of months) {
    await sleep(500); // Be polite
    const dates = await fetchCalendar(sessionId, month);
    dates.forEach((d) => dateSet.add(d));
  }

  // Filter to only today and future dates
  const todayStr = formatDateStr(now);
  let allDates = [...dateSet].filter((d) => d >= todayStr).sort();
  console.log(`[MAIN] Total future dates to scrape: ${allDates.length} (filtered from ${dateSet.size} total)`);

  if (allDates.length === 0) {
    console.log('[MAIN] No available dates found. The calendar may be empty or the session expired.');
    console.log('[MAIN] Saving empty snapshot.');
  }

  // Step 4: Fetch tee times for each date
  const dateData = {};
  let consecutiveEmpty = 0;
  for (const dateStr of allDates) {
    await sleep(300); // Be polite - 300ms between requests
    try {
      const teetimes = await fetchTeeTimes(sessionId, dateStr);
      const stats = computeStats(teetimes);
      const dayOfWeek = getDayOfWeek(dateStr);

      dateData[dateStr] = {
        dayOfWeek,
        teetimes,
        stats,
      };

      if (teetimes.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
      }

      console.log(
        `[TEETIMES] ${dateStr} (${dayOfWeek}): ${teetimes.length} slots, ` +
        `fee range: ${stats.minFee ? stats.minFee.toLocaleString() : 'N/A'} - ${stats.maxFee ? stats.maxFee.toLocaleString() : 'N/A'}`
      );

      // Stop early if we hit 5 consecutive dates with no tee times (not yet open)
      if (consecutiveEmpty >= 5) {
        console.log(`[MAIN] Stopping early: ${consecutiveEmpty} consecutive empty dates (likely not yet open for booking).`);
        break;
      }
    } catch (err) {
      console.error(`[ERROR] Failed to fetch tee times for ${dateStr}:`, err.message);
    }
  }

  // Step 5: Save snapshot
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const snapshot = {
    course: 'montvert',
    courseName: 'Montvert CC (몽베르 CC)',
    scrapedAt: new Date().toISOString(),
    scrapedDate: today,
    totalDatesScraped: Object.keys(dateData).length,
    dates: dateData,
  };

  const snapshotPath = path.join(DATA_DIR, `${today}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`[SAVE] Snapshot saved to: ${snapshotPath}`);

  // Step 6: Update index
  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    index = { courses: [], lastUpdated: null, snapshots: [] };
  }

  index.lastUpdated = new Date().toISOString();

  // Add snapshot reference if not already present
  if (!index.snapshots.includes(today)) {
    index.snapshots.push(today);
    index.snapshots.sort();
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`[SAVE] Index updated. Total snapshots: ${index.snapshots.length}`);
  syncToDocs(snapshotPath, today);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s ===`);
}

/**
 * Format Date to YYYYMMDD string.
 */
function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});

