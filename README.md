# Anti_Ken

Personal automation monorepo. Each project lives in its own folder under `projects/` with its own README, dependencies and `.env.example`, and runs on a schedule in GitHub Actions.

| Project | What it does | Schedule (KST) | Workflow |
|---|---|---|---|
| [🌅 Morning Briefing](projects/morning-briefing/) | US stock moves + top news by category (general / economy / IT) to Telegram | 07:00 daily | `morning_briefing.yml` |
| [⛳ Golf Green Fees](projects/golf-fees/) | Scrapes Montvert CC green fees; dashboard on GitHub Pages | 09:00 daily | `scrape.yml` → `pages.yml` |

```
├── projects/
│   ├── morning-briefing/   # Telegram morning briefing bot
│   └── golf-fees/          # Green fee scraper
├── docs/                   # GitHub Pages dashboard (code only)
└── .github/workflows/      # One workflow per job
```

**Branches**
- `main` — code only.
- `data` — generated data (daily green fee snapshots), committed by Actions. Kept separate so automated commits don't bury code history.

## Adding a project

1. Create `projects/<name>/` with its own `package.json`, `README.md` and `.env.example`.
2. Add `.github/workflows/<name>.yml` with `working-directory: projects/<name>`.
3. Put secrets in **Settings → Secrets and variables → Actions** — never in files. If the project produces data, commit it to the `data` branch under `<name>/`.
4. Add a row to the table above.
