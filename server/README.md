
# Arise & Shine Server

Express API + SQLite datastore powering logistics orders, AI content, telemetry, and financial insights.

## Highlights
- Authenticated roles: `ADMIN`, `OPS`, `DRIVER`, `FUEL`, `CUSTOMER`.
- Daily OpenAI article generator with Unsplash imagery and manual trigger (`POST /api/admin/articles/generate`).
- Extended finance suite: summary, timeseries, per-truck breakdown, monthly P&L.
- Live telemetry connector (`GET /api/telemetry/trucks`) with idle alert heuristics and Protrack 365 integration.
- Fuel logging endpoints with image uploads stored under `server/uploads`.
- AI insights endpoint returning actionable alerts for ops dashboards.

## Setup
```bash
cd server
cp .env.example .env   # populate keys described below
npm install
npm run seed           # for demo users/trucks/drivers
npm start              # or npm run dev
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables article generation and AI insights (optional). |
| `OPENAI_ARTICLE_MODEL` | (Optional) override model for articles (default `gpt-4o-mini`). |
| `OPENAI_INSIGHTS_MODEL` | (Optional) override model for insights. |
| `UNSPLASH_ACCESS_KEY` | Fetch Unsplash images for articles (falls back to public source if absent). |
| `PROTRACK_API_URL` | Base URL for Protrack 365 telemetry API (optional). |
| `PROTRACK_API_TOKEN` | Bearer token for telemetry requests. |
| `PROTRACK_TENANT_ID` | Optional tenant header for Protrack. |
| `LOW_STOCK_THRESHOLD` | Tonnes threshold for stock alerts (default 50). |
| `TELEMETRY_IDLE_THRESHOLD_MIN` | Minutes before an idle alert is raised (default 120). |
| `ARTICLE_GENERATION_HOUR` / `ARTICLE_GENERATION_MINUTE` | Scheduler trigger time (defaults 05:20). |
| `DISABLE_AUTO_ARTICLES` | Set to `1` to disable automatic daily articles. |

Uploads (fuel photos) are stored under `server/uploads` and served at `http://host:port/uploads/<filename>`.
