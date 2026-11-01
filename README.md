# Anti_Ken

Personal automation repo with two independent Node.js projects, both run daily by GitHub Actions:

| Project | What it does | Schedule (KST) | Workflow |
|---|---|---|---|
| [🌅 Morning Briefing](#-morning-briefing-telegram-bot) | Sends overnight US news + stock moves to Telegram | 07:00 daily | `morning_briefing.yml` |
| [⛳ Green Fee Tracker](#-golf-green-fee-tracker) | Scrapes Montvert CC green fees, publishes a dashboard | 09:00 daily | `scrape.yml` |

```
├── morning-briefing/    # Telegram morning briefing bot
├── scraper/             # Golf green fee scraper
├── data/                # Daily green fee snapshots (source of truth)
├── docs/                # GitHub Pages dashboard (+ docs/data mirror of data/)
└── .github/workflows/   # morning_briefing.yml, scrape.yml
```

---

## 🌅 Morning Briefing Telegram Bot

Collects overnight US headlines and key index/stock movements, formats a briefing, and sends it via the Telegram Bot API.

- **News** — RSS: Google News (US), Yahoo Finance, WSJ Markets, CNBC
- **Markets** — Yahoo Finance chart API
  - Indices: `^GSPC` (S&P 500), `^IXIC` (Nasdaq), `^DJI` (Dow)
  - Equities: `NVDA, AAPL, MSFT, TSLA, GOOGL, AMZN, NTAP`

### Run locally

```bash
cd morning-briefing
cp .env.example .env   # fill in Telegram values (optional)
npm install
bash run.sh
```

If `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing, it runs in **console preview mode** and prints the briefing instead of sending it.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Bot token from [@BotFather](https://t.me/botfather) (`/newbot`) |
| `TELEGRAM_CHAT_ID` | — | Your chat ID ([@userinfobot](https://t.me/userinfobot)) or a channel like `@my_channel` |
| `INDICES` | `^GSPC,^IXIC,^DJI` | Comma-separated index symbols |
| `EQUITIES` | `NVDA,AAPL,MSFT,TSLA,GOOGL,AMZN,NTAP` | Comma-separated stock tickers |
| `TIMEZONE` | `Asia/Seoul` | Timezone for date headers |

> In GitHub Actions, `INDICES` / `EQUITIES` / `TIMEZONE` are set in `.github/workflows/morning_briefing.yml` and override the defaults — edit the ticker list there.

### GitHub Actions

Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` under **Settings → Secrets and variables → Actions**. Runs at 22:00 UTC (07:00 KST); trigger manually via **Actions → Morning Briefing Telegram Bot → Run workflow**.

---

## ⛳ Golf Green Fee Tracker

Logs into Montvert CC (몽베르 CC), collects available tee times and green fees for the current and next month, saves a daily JSON snapshot, and renders trends on a GitHub Pages dashboard.

### Features

- **Daily price monitoring** — automated scraping via GitHub Actions
- **Trend analysis** — min / avg / max green fee over time
- **Day-of-week comparison** — weekday vs. weekend pricing
- **Date analysis** — compare any date against the previous day, same day last week, same day last month, and 7- / 30-day rolling averages
- **Tee time details** — browse all available slots with pricing

### Run locally

```bash
cd scraper
npm install
MONTVERT_USER_ID=... MONTVERT_PASSWORD=... npm run scrape
```

Credentials can also go in `scraper/.env`. Without credentials the scraper runs in **mock mode** and writes sample data (disabled in CI).

The scraper writes `data/montvert/YYYY-MM-DD.json`, updates `data/index.json`, and mirrors both into `docs/data/`.

### Preview the dashboard

```bash
cd docs
python3 -m http.server 8080
# open http://localhost:8080
```

### Data safety

- If a run collects **zero tee times** (login failure, expired session, site change), the scraper **exits with an error and saves nothing**, so empty snapshots are never committed and the failed workflow run is visible in the Actions tab.
- In CI, missing credentials are an error rather than falling back to mock data.

### GitHub setup

**Secrets** (Settings → Secrets and variables → Actions):

| Secret | Description |
|---|---|
| `MONTVERT_USER_ID` | Montvert CC web member ID |
| `MONTVERT_PASSWORD` | Montvert CC password |

**GitHub Pages** (Settings → Pages): Source **Deploy from a branch**, branch **main**, folder **/docs**.

Runs at 00:00 UTC (09:00 KST) and auto-commits new data as `data: daily green fee snapshot [skip ci]`. Manual run: **Actions → Scrape Green Fees → Run workflow**.

### Data format

```json
{
  "course": "montvert",
  "courseName": "Montvert CC (몽베르 CC)",
  "scrapedAt": "2026-06-26T14:30:00.000Z",
  "scrapedDate": "2026-06-26",
  "totalDatesScraped": 1,
  "dates": {
    "20260628": {
      "dayOfWeek": "Sunday",
      "teetimes": [
        { "course": "망무봉(OUT)", "time": "12:28", "holes": 18, "fee": 150000, "event": "" }
      ],
      "stats": { "minFee": 140000, "maxFee": 160000, "avgFee": 150769, "medianFee": 150000, "count": 13 }
    }
  }
}
```

### Tracked courses

| Course | Status |
|---|---|
| Montvert CC (몽베르 CC) | ✅ Active |
