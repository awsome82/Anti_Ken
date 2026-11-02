# Anti_Ken

Personal automation repo with two independent Node.js projects, both run daily by GitHub Actions:

| Project | What it does | Schedule (KST) | Workflow |
|---|---|---|---|
| [🌅 Morning Briefing](#-morning-briefing-telegram-bot) | Sends US stock moves + top news by category (general / economy / IT) to Telegram | 07:00 daily | `morning_briefing.yml` |
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

Sends a Korean morning briefing to Telegram with US market moves and the top US news by category.

- **Markets** — Yahoo Finance chart API
  - Indices: `^GSPC` (S&P 500), `^IXIC` (Nasdaq), `^DJI` (Dow)
  - Equities: `NVDA, AAPL, MSFT, TSLA, GOOGL, AMZN, NTAP`
- **News by category** — 3 stories each, with a Korean summary and a source link

  | Category | Feeds |
  |---|---|
  | 🇺🇸 일반 (General) | NPR, BBC News (US & Canada), Google News (US) |
  | 💵 경제 (Economy) | CNBC Economy, MarketWatch, WSJ Markets, Google News (Business) |
  | 💻 IT | TechCrunch, The Verge, Ars Technica, Google News (Technology) |

### How news is selected

1. **Collect.** Read the latest ~10 items from each feed. Google News items are credited to the original publisher.
2. **Filter.** Drop stories older than 36 hours, plus formats that are rarely news: podcasts, opinion, explainers, live blogs, newsletters, reviews and shopping deals.
3. **Rank (rule-based, free).** Score each story by how many *other* outlets cover the same event, with small bonuses for recency and Google News' own ordering. Exact duplicates are merged, and the same event is never shown in two categories.
4. **Select & summarize (AI).** An AI picks the 3 most consequential stories per category and writes a Korean headline and a 2-sentence summary for each. It uses only facts from the feed's headline and description. Source names and links always come from the feed. Providers are tried in this order:

   | Provider | Cost | Setup |
   |---|---|---|
   | Claude API | Paid (~$0.1–5/month depending on model) | Add the `ANTHROPIC_API_KEY` secret |
   | **GitHub Models** (default) | **Free tier** | None. The workflow's built-in `GITHUB_TOKEN` with `models: read` is enough |

5. **Fallback.** If no AI is available or a call fails, the top rule-based stories are machine-translated. The briefing footer shows which method ran.

### Run locally

```bash
cd morning-briefing
cp .env.example .env   # fill in values (all optional)
npm install
DRY_RUN=true bash run.sh
```

`DRY_RUN=true` prints the briefing instead of sending it. Without Telegram credentials, the bot also prints the briefing in preview mode.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Bot token from [@BotFather](https://t.me/botfather) (`/newbot`) |
| `TELEGRAM_CHAT_ID` | — | Your chat ID ([@userinfobot](https://t.me/userinfobot)) or a channel like `@my_channel` |
| `GITHUB_TOKEN` | — (set automatically in Actions) | Token for GitHub Models. Locally, use a personal access token with the `models:read` permission. `GITHUB_MODELS_TOKEN` takes precedence if set |
| `GITHUB_MODELS` | `openai/gpt-4.1-mini,openai/gpt-4o-mini` | GitHub Models to try, in order |
| `ANTHROPIC_API_KEY` | — | Optional, paid. Claude API key; when set, Claude is used instead of GitHub Models |
| `CLAUDE_MODEL` / `CLAUDE_EFFORT` | `claude-opus-5-5` / `medium` | Claude model and effort |
| `DRY_RUN` | `false` | `true` prints the briefing instead of sending it |
| `INDICES` | `^GSPC,^IXIC,^DJI` | Comma-separated index symbols |
| `EQUITIES` | `NVDA,AAPL,MSFT,TSLA,GOOGL,AMZN,NTAP` | Comma-separated stock tickers |
| `TIMEZONE` | `Asia/Seoul` | Timezone for date headers |

News categories and feeds are defined in `morning-briefing/src/config.js` (`newsCategories`).

> In GitHub Actions, `INDICES`, `EQUITIES` and `TIMEZONE` are set in `.github/workflows/morning_briefing.yml` and override the defaults. To change the ticker list, edit it there.

### GitHub Actions

Add these secrets under **Settings → Secrets and variables → Actions**:
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- `ANTHROPIC_API_KEY`, optional (paid). Without it, the free GitHub Models tier is used through the workflow's built-in token

The workflow runs daily at 22:00 UTC (07:00 KST). To run it manually, go to **Actions → Morning Briefing Telegram Bot → Run workflow**. Tick **dry_run** to see the briefing in the job log without sending it.

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
