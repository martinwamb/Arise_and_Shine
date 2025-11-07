
# Arise & Shine Server

Express API + SQLite datastore powering logistics orders, AI content, telemetry, and financial insights.

## Highlights
- Authenticated roles: `ADMIN`, `OPS`, `DRIVER`, `FUEL`, `CUSTOMER`.
- Daily OpenAI article generator with Unsplash imagery and manual trigger (`POST /api/admin/articles/generate`).
- Extended finance suite: summary, timeseries, per-truck breakdown, monthly P&L.
- Live telemetry connector (`GET /api/telemetry/trucks`) with idle alert heuristics and Protrack 365 integration.
- Fuel logging endpoints with image uploads stored under `server/uploads`.
- AI insights endpoint returning actionable alerts for ops dashboards.
- Self-service password reset flow with email tokens and configurable expiry.

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
| `APP_BASE_URL` | Base URL used in password reset emails (defaults to `http://localhost:5173`). |
| `PASSWORD_RESET_TTL_MINUTES` | Minutes before password reset links expire (default `60`). |
| `OPENAI_ARTICLE_MODEL` | (Optional) override model for articles (default `gpt-4o-mini`). |
| `OPENAI_INSIGHTS_MODEL` | (Optional) override model for insights. |
| `UNSPLASH_ACCESS_KEY` | Fetch Unsplash images for articles (falls back to public source if absent). |
| `PROTRACK_BASE_URL` | Base host for Protrack 365 API (default `https://api.protrack365.com`). |
| `PROTRACK_ACCOUNT` | Account/username used to request access tokens. |
| `PROTRACK_PASSWORD` | Password used to generate the signature for token refresh. |
| `PROTRACK_TRACK_PATH` | Relative path appended to the base URL for telemetry (default `/api/track`). |
| `PROTRACK_TRACK_MODE` | Force telemetry auth mode: `query` (default for Protrack 365) or `header` (legacy). |
| `PROTRACK_TRACK_IMEIS` | Optional comma-separated IMEI/device list passed to the track endpoint. |
| `PROTRACK_TRUCK_IMEI_MAP` | Optional JSON map of truck IDs (or plate labels) to IMEI values; entries auto-create trucks and override display plates. |
| `PROTRACK_ACCESS_TOKEN_PARAM` | Query parameter name carrying the access token (default `access_token`). |
| `PROTRACK_API_TOKEN` | Optional static access token for telemetry requests (skips auto-refresh). |
| `PROTRACK_TRACK_URL` | Optional fully-qualified telemetry endpoint override. |
| `PROTRACK_API_URL` | Legacy base URL used when tokens are sent via `Authorization` header. |
| `PROTRACK_AUTH_URL` | Legacy auth endpoint override if Protrack provides a custom URL. |
| `PROTRACK_AUTH_METHOD` | (Legacy) HTTP method for custom auth (`POST` default, supports `GET`). |
| `PROTRACK_AUTH_FORMAT` | (Legacy) Request body format (`json` default, supports `form`). |
| `PROTRACK_AUTH_HEADERS` | Optional JSON object of extra headers for auth requests. |
| `PROTRACK_TENANT_ID` | Optional tenant header for telemetry calls. |
| `GEOCODER_ENDPOINT` | Forward geocoding endpoint used for pricing distance lookups (default OpenStreetMap Nominatim). |
| `GEOCODER_REVERSE_ENDPOINT` | Reverse geocoding endpoint used to derive town names for telemetry coordinates. |
| `GEOCODER_EMAIL` | Contact email passed to the geocoder user agent for courtesy identification. |
| `GEOCODER_USER_AGENT` | Custom user agent when calling the geocoder endpoints. |
| `TELEMETRY_AI_ANALYSIS_INTERVAL_MS` | Minimum milliseconds between AI telemetry analyses (default 300000). |
| `TELEMETRY_AI_LOOKBACK_MINUTES` | Minutes of telemetry history to include in AI review windows (default 240). |
| `TELEMETRY_AI_MIN_POINTS` | Minimum data points required before AI analysis runs (default 6). |
| `TELEMETRY_AI_MAX_POINTS` | Maximum points passed to the AI per truck window (default 60). |
| `TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE` | Confidence threshold (0–1) required to persist AI anomaly alerts (default 0.55). |
| `TELEMETRY_AI_MODEL` | OpenAI model identifier for telemetry analytics (default `gpt-4o-mini`). |
| `TELEMETRY_HIDE_PLATES` | Comma-separated list of registration plates to hide from fleet telemetry (case-insensitive). |
| `TELEMETRY_HIDE_TRUCK_IDS` | Optional comma-separated truck IDs to hide (applied after plate filter). |
| `LOW_STOCK_THRESHOLD` | Tonnes threshold for stock alerts (default 50). |
| `TELEMETRY_IDLE_THRESHOLD_MIN` | Minutes before an idle alert is raised (default 120). |
| `TELEMETRY_SPEED_ALERT_KPH` | Speed limit in km/h that triggers Telegram/email speeding alerts (default 65). |
| `TELEMETRY_SPEED_ALERT_COOLDOWN_MIN` | Cooldown window in minutes before another speeding alert for the same truck (default 10). |
| `ARTICLE_GENERATION_HOUR` / `ARTICLE_GENERATION_MINUTE` | Scheduler trigger time (defaults 05:20). |
| `DISABLE_AUTO_ARTICLES` | Set to `1` to disable automatic daily articles. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP credentials for transactional email. Use `SMTP_URL` for a single connection string if preferred. |
| `SMTP_URL` | Alternative SMTP connection URI (overrides host/port settings when provided). |
| `SMTP_FROM` | From address for outbound customer/ops emails (defaults to `no-reply@arise.local`). |
| `NOTIFICATION_DISPATCH_INTERVAL_MS` | Email dispatcher polling interval in milliseconds (default 30000). |
| `NOTIFICATION_DISPATCH_BATCH` | Maximum queued emails processed per cycle (default 10). |
| `NOTIFICATION_MAX_ATTEMPTS` | Retry cap before a notification is marked as `FAILED` (default 5). |
| `ADMIN_*`, `OPS_*`, `FUEL_*`, `DRIVER_*` | Optional overrides for core role accounts (see “Core role bootstrap” below). |

Uploads (fuel photos) are stored under `server/uploads` and served at `http://host:port/uploads/<filename>`.

### Email notifications

Set SMTP credentials via `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (or a single `SMTP_URL`) to enable transactional email. The server now maintains a notification queue with automatic retries and a background dispatcher. Admins can monitor and manually trigger delivery from the ops dashboard (Email notifications panel). Failed attempts are retained with the last error message for review.

Dispatcher tuning:

- `NOTIFICATION_DISPATCH_INTERVAL_MS` controls how often the background worker scans for queued emails.
- `NOTIFICATION_DISPATCH_BATCH` limits the number of messages processed per cycle.
- `NOTIFICATION_MAX_ATTEMPTS` caps retry attempts before a notification is marked as `FAILED`.

### Resetting core user passwords

If you ever lose access to an admin/ops/fuel/driver account (or simply want to rotate credentials) without keeping the plain text password in `.env`, use the helper script:

```bash
# Example: reset the admin password to NewPass!234
cd server
npm run reset-core-user -- --role ADMIN --email admin@example.com --password "NewPass!234"
```

If the account does not exist yet, add `--create` (and optionally `--name`, `--phone`, `--driver-id`) to insert it before setting the password:

```bash
npm run reset-core-user -- --role ADMIN --email admin@example.com --password "NewPass!234" --create --name "Admin User"
```

The script loads the database in-place, hashes the provided password, and updates the selected user's record. Once the password is rotated you can remove the corresponding `ADMIN_*` variables from your deployed environment; they are only required when you want the bootstrapper to create/update the account automatically on startup.

### Core role bootstrap

Define environment variables such as `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OPS_EMAIL`, `FUEL_EMAIL`, and `DRIVER_EMAIL` to automatically create or update the built-in role accounts on startup. Optional fields (`*_NAME`, `*_PHONE`, and for drivers `DRIVER_DRIVER_ID`, `DRIVER_DRIVER_NAME`, `DRIVER_DRIVER_PHONE`, `DRIVER_DRIVER_EMAIL`) let you pre-fill staff details and link the driver login to an existing driver profile. Leave a variable unset to keep the current value.
