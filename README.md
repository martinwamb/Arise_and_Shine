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
| `PROTRACK_API_TOKEN` | Bearer token for telemetry calls. |
| `PROTRACK_TENANT_ID` | Optional tenant header for Protrack. |
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

```bash
cd web
npm install
VITE_API_BASE=http://localhost:4000 npm run dev
```

Run `npm run build` to produce the Vite bundle (chunk size warnings are expected because of dashboard libraries).

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

## Protrack 365 integration guidance
- **Geocoding**: the quote engine geocodes site locations via OpenStreetMap Nominatim by default. Set GEOCODER_EMAIL (and optionally GEOCODER_ENDPOINT / GEOCODER_USER_AGENT) to comply with usage policies or point at your own service.

- **Obtain sandbox credentials**: Protrack issues API access on a tenant-by-tenant basis. Share your account/tenant ID with the Protrack 365 support team (support@protrackgps.com) and request REST API credentials (base URL + bearer token). They typically provision an API token tied to your organisation and optionally a per-tenant header.
- **Production tokens**: once live, request a long-lived token and schedule periodic rotation (the backend reads it from `PROTRACK_API_TOKEN`). If you use a reverse proxy, allow outbound HTTPS traffic to `PROTRACK_API_URL`.
- **Fallback mode**: when the variables are unset the server automatically returns simulated telemetry so dashboards remain functional while waiting for credentials.
- **Testing**: after setting `PROTRACK_API_URL`, `PROTRACK_API_TOKEN` (and optional `PROTRACK_TENANT_ID`), hit `/api/telemetry/trucks` from the admin dashboard to confirm live data. Errors will surface in the notifications log and AI insights panel.
