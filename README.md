# Arise & Shine v5

Smart logistics tooling for sand and aggregates: animated marketing site, AI-authored daily briefings, multi-role dashboards, and live truck telemetry.

## Feature highlights
- **Interactive landing** with distance-aware pricing with live geocoding from Thika (KES 32,000 base, +KES 1,000 every 5 km), AI articles surfaced publicly, WhatsApp/call/email CTAs, and a OpenAI-powered chatbot for FAQs.
- **Guest-to-payment flow**: guest orders create leads, authenticated customers see bank paybills (ABSA, Equity, KCB, NCBA, Cooperative) and upload transaction references before dispatch.
- **Role-based dashboards** with refined permissions:
  - **Admin**: overview, orders, stock, finance, AI insights, telemetry, cost control.
  - **Operations**: focused stock receipts, expenses, and live telemetry (no order/finance access).
  - **Driver**: performance dashboard plus profile completion (contact info, national ID, photo uploads).
  - **Fuel monitor**: fuel + mileage capture now including cost attribution that automatically logs expenses.
- **Dual-category stock management** (coarse vs smooth) tracked in truck loads (20 tonnes each) with transaction history and automatic order deductions.
- **Telemetry & alerts** via Protrack 365 API (simulation fallback) feeding idle alerts, with a server-side notifications queue ready for email delivery.
- Expanded finance suite (P&L endpoint, per-truck breakdown, timeseries) and AI recommendations enriched with trend detection.

## Backend
See [`server/README.md`](./server/README.md) for detailed setup. Key environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables AI articles and insight summaries. |
| `OPENAI_ARTICLE_MODEL` | (Optional) override model used for article generation. |
| `OPENAI_INSIGHTS_MODEL` | (Optional) override model for ops insights. |
| `OPENAI_CHATBOT_MODEL` | (Optional) override model used for the landing-page assistant. |
| `UNSPLASH_ACCESS_KEY` | Fetches hero images for articles (falls back to source.unsplash.com if missing). |
| `PROTRACK_API_URL` | Base URL for Protrack 365 telemetry API. |
| `PROTRACK_API_TOKEN` | Static bearer token for telemetry calls (optional when auto-refresh is configured). |
| `PROTRACK_AUTH_URL` | Optional: Protrack auth endpoint returning `access_token` + `expires_in` for automatic refresh. |
| `PROTRACK_ACCOUNT` | Optional: Protrack account/user for token refresh. |
| `PROTRACK_PASSWORD` | Optional: Protrack password for token refresh. |
| `PROTRACK_AUTH_METHOD` | Optional: HTTP method for auth call (`POST` default, supports `GET`). |
| `PROTRACK_AUTH_FORMAT` | Optional: `json` (default) or `form` body when obtaining the token. |
| `PROTRACK_AUTH_HEADERS` | Optional JSON map of extra headers for the auth request (e.g. tenant IDs). |
| `PROTRACK_TENANT_ID` | Optional tenant header for Protrack telemetry requests. |
| `LOW_STOCK_THRESHOLD` | Tonnes threshold that triggers low-stock alerts. |
| `TELEMETRY_IDLE_THRESHOLD_MIN` | Idle minutes before raising alerts (default 120). |
| `TRUCK_UNIT_TONNES` | Tonnes equivalent for one truck load (default 20). |
| `BASE_PRICE_PER_TRUCK` | Base price (KES) per truck for sites within the base distance (default 32000). |
| `BASE_DISTANCE_KM` | Distance (km) covered by the base price before increments apply (default 15). |
| `PRICE_INCREMENT_KM` | Distance step (km) for each price increment (default 5). |
| `PRICE_INCREMENT_AMOUNT` | Increment amount (KES) per step beyond the base distance (default 1000). |
| `ARTICLE_GENERATION_HOUR` / `ARTICLE_GENERATION_MINUTE` | Schedule daily article job (defaults 05:20). |
| `DISABLE_AUTO_ARTICLES` | Set to `1` to turn off scheduler. |

The server stores uploads under `server/uploads` and exposes them at `/uploads/*`.

## Frontend

### Web (Vite)

```bash
cd web
npm install
VITE_API_BASE=http://localhost:4000 npm run dev
```

Run `npm run build` to produce the Vite bundle (chunk size warnings are expected because of dashboard libraries).

### Mobile (Expo React Native)

```bash
cd mobile
cp .env.example .env   # sets EXPO_PUBLIC_API_BASE consumed by app.config.ts
npm install
npm run android        # or npm start to open Expo dev tools
```

The Expo app consumes the exact same Express API via the shared client in `shared/api-client`, and `app.config.ts` injects the API base into `Constants.expoConfig.extra` so the runtime knows which server to call. Once the UI is ready for production, create a signed Android App Bundle (AAB) with:

```bash
# first login: npx expo login
npx expo run:android --variant release                       # local Gradle build
# or use EAS for store-ready bundles (uses mobile/.eas.json)
(cd mobile && npx eas build --platform android --profile production)
```

Upload the resulting `.aab` to Google Play Console (internal testing → production) while continuing to deploy the backend/web front-end through the Contabo workflow.

### Shared API client

`shared/api-client` centralises axios + token handling so both the Vite SPA and the Expo project talk to the same Express endpoints with identical auth headers and helper methods.

## Roles & default users
Seed script provisions:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@arise.local` | `admin123` |
| Ops | `ops@arise.local` | `ops123` |
| Driver | `driver@arise.local` | `driver123` |
| Fuel monitor | `fuel@arise.local` | `fuel123` |
| Customer (demo) | `customer@arise.local` | `customer123` |

Customers self-register via the landing page. Each role lands on the appropriate dashboard after login.

### Production accounts & email delivery
- Override the default logins by setting `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `OPS_*`, `FUEL_*`, and `DRIVER_*` environment variables before starting the API. The server bootstraps or updates those records (including driver profile linkage) automatically.
- Configure SMTP credentials (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` or a single `SMTP_URL`) so queued notifications are delivered to customers and internal teams. The admin dashboard now exposes an Email notifications panel to monitor the queue, resend failures, and confirm dispatch status.
- Provide a live `OPENAI_API_KEY` (and optional model overrides) to unlock AI-generated briefings, insights, and the landing-page assistant. Trigger `/api/admin/articles/generate` from the Admin dashboard to verify the integration immediately.

## Protrack 365 integration guidance
- **Geocoding**: the quote engine geocodes site locations via OpenStreetMap Nominatim by default. Set GEOCODER_EMAIL (and optionally GEOCODER_ENDPOINT / GEOCODER_USER_AGENT) to comply with usage policies or point at your own service.

- **Obtain sandbox credentials**: Protrack issues API access on a tenant-by-tenant basis. Share your account/tenant ID with the Protrack 365 support team (support@protrackgps.com) and request REST API credentials (base URL + bearer token). They typically provision an API token tied to your organisation and optionally a per-tenant header.
- **Production tokens**: once live, request a long-lived token and schedule periodic rotation. The backend now supports automatic refresh when `PROTRACK_AUTH_URL`, `PROTRACK_ACCOUNT`, and `PROTRACK_PASSWORD` are supplied (it will call the endpoint, cache the bearer token, and refresh one minute before expiry). If you use a reverse proxy, allow outbound HTTPS traffic to `PROTRACK_API_URL`.
- **Fallback mode**: when the variables are unset the server automatically returns simulated telemetry so dashboards remain functional while waiting for credentials.
- **Testing**: after setting `PROTRACK_API_URL`, `PROTRACK_API_TOKEN` (and optional `PROTRACK_TENANT_ID`), hit `/api/telemetry/trucks` from the admin dashboard to confirm live data. Errors will surface in the notifications log and AI insights panel.
