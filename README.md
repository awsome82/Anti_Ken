# 🌅 Morning Briefing Telegram Bot & Market Tracker

An automated Node.js system that collects overnight US major news headlines and key US stock market index/ticker movements, formats a rich morning briefing, and sends it via Telegram Bot API daily at 7:00 AM KST.

## 🚀 Quick Start (Morning Briefing)

```bash
cd morning-briefing
npm install
bash run.sh
```

> **Note**: If `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` are not set in `morning-briefing/.env`, the script runs in **Console Preview Mode**, displaying the formatted briefing directly in your terminal.

---

### 📲 Setting Up Telegram Delivery

1. **Create a Telegram Bot**:
   - Message [@BotFather](https://t.me/botfather) on Telegram.
   - Run `/newbot`, choose a name and username.
   - Copy the HTTP API **Token**.

2. **Get your Chat ID**:
   - Message [@userinfobot](https://t.me/userinfobot) to get your personal `CHAT_ID`, or use your Telegram Channel username (e.g., `@my_channel`).

3. **Configure Environment**:
   - Edit `morning-briefing/.env`:
     ```env
     TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyZ
     TELEGRAM_CHAT_ID=123456789
     ```

4. **GitHub Actions Automation**:
   - Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to **GitHub Repo → Settings → Secrets and variables → Actions**.
   - The briefing will automatically deliver every morning at **7:00 AM KST** (22:00 UTC).

---

# ⛳ Golf Green Fee Tracker

Track daily green fee trends for golf courses. See how prices change over time, compare weekday vs. weekend rates, and find the cheapest tee times.

## 🏗️ Architecture

```
├── morning-briefing/ # US Major News & Stock Market Morning Briefing Telegram Bot
├── scraper/          # Node.js Golf Green Fee scraper
├── data/             # Raw JSON snapshots (one file per scrape day)
├── docs/             # Dashboard (GitHub Pages SPA)
└── .github/workflows # CI/CD automation workflows
```

## 🚀 Quick Start (Golf Scraper)

```bash
cd scraper
npm install
bash run.sh
```


### 3. Preview the dashboard

```bash
# Copy data to docs folder
mkdir -p docs/data/montvert
cp data/index.json docs/data/index.json
cp data/montvert/*.json docs/data/montvert/

# Start local server
cd docs
python3 -m http.server 8080
# Open http://localhost:8080
```

## 🔐 GitHub Setup

### Secrets (required for automated scraping)

Go to **Settings → Secrets → Actions** and add:

| Secret | Description |
|---|---|
| `MONTVERT_USER_ID` | Montvert CC web member ID |
| `MONTVERT_PASSWORD` | Montvert CC password |

### GitHub Pages

1. Go to **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/docs**
4. Save

### Manual trigger

Go to **Actions → Scrape Green Fees → Run workflow**

## 📊 Features

- **Daily price monitoring** — automated scraping via GitHub Actions cron
- **Trend analysis** — min/avg/max green fee over time
- **Day-of-week comparison** — weekday vs. weekend pricing
- **Date analysis** — compare any date against:
  - Previous day
  - Same day last week
  - Same day last month
  - 7-day rolling average
  - 30-day rolling average
- **Tee time details** — browse all available slots with pricing

## 📁 Data Format

Each daily snapshot (`data/montvert/YYYY-MM-DD.json`) contains:

```json
{
  "course": "montvert",
  "scrapedAt": "2026-06-26T14:30:00.000Z",
  "dates": {
    "20260628": {
      "dayOfWeek": "Sunday",
      "teetimes": [
        { "course": "망무봉(OUT)", "time": "12:28", "holes": 18, "fee": 150000 }
      ],
      "stats": { "minFee": 140000, "maxFee": 160000, "avgFee": 150769 }
    }
  }
}
```

## 🎯 Tracked Courses

| Course | Status |
|---|---|
| Montvert CC (몽베르 CC) | ✅ Active |
