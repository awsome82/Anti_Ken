# ⛳ Golf Green Fee Tracker

Logs into Montvert CC (몽베르 CC), collects available tee times and green fees for the current and next month, saves a daily JSON snapshot, and renders trends on a GitHub Pages dashboard.

## Features

- **Daily price monitoring** — automated scraping via GitHub Actions
- **Trend analysis** — min / avg / max green fee over time
- **Day-of-week comparison** — weekday vs. weekend pricing
- **Date analysis** — compare any date against the previous day, same day last week, same day last month, and 7- / 30-day rolling averages
- **Tee time details** — browse all available slots with pricing

## Where the data lives

Daily snapshots are committed to the repo's **`data` branch** (not `main`), so code history stays clean:

```
data branch
├── index.json            # list of snapshot dates
└── montvert/YYYY-MM-DD.json
```

The `Deploy Dashboard` workflow combines `docs/` (from `main`) with the `data` branch and publishes the result to GitHub Pages.

## Run locally

```bash
cd projects/golf-fees
npm install
git fetch origin data && git worktree add data data   # optional: real history
MONTVERT_USER_ID=... MONTVERT_PASSWORD=... bash run.sh
```

Credentials can also go in `projects/golf-fees/.env` (see `.env.example`). Without credentials the scraper runs in **mock mode** and writes sample data (disabled in CI). Output goes to `projects/golf-fees/data/` (git-ignored on `main`), or to `$DATA_ROOT` if set.

## Preview the dashboard

```bash
rm -rf docs/data && cp -r projects/golf-fees/data docs/data
cd docs && python3 -m http.server 8080   # open http://localhost:8080
```

## Data safety

- If a run collects **zero tee times** (login failure, expired session, site change), the scraper **exits with an error and saves nothing**, so empty snapshots are never committed and the failed workflow run is visible in the Actions tab.
- In CI, missing credentials are an error rather than falling back to mock data.

## GitHub setup

**Secrets** (Settings → Secrets and variables → Actions):

| Secret | Description |
|---|---|
| `MONTVERT_USER_ID` | Montvert CC web member ID |
| `MONTVERT_PASSWORD` | Montvert CC password |

**GitHub Pages** (Settings → Pages): Source **GitHub Actions**.

Runs at 00:00 UTC (09:00 KST) and commits the snapshot to the `data` branch; the dashboard is redeployed automatically when the scrape succeeds. Manual run: **Actions → Scrape Green Fees → Run workflow**.

## Data format

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

## Tracked courses

| Course | Status |
|---|---|
| Montvert CC (몽베르 CC) | ✅ Active |
