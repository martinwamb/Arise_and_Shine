# Arise & Shine v5 — Project Overview

## What It Is

A full-stack logistics management platform for sand and aggregate delivery operations in East Africa. It handles order management, fleet telemetry, driver tracking, cost auditing, financial reporting, and AI-powered operational intelligence.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js, SQLite 3 (WAL mode) |
| Frontend (Web) | Vite, React 18, TypeScript, Tailwind CSS |
| Mobile | Expo, React Native, TypeScript |
| Authentication | JWT + bcrypt |
| AI | OpenAI SDK (supports local OpenAI-compatible endpoints) |
| Telemetry | Protrack 365 API + Cartrack Fleet API |
| Geocoding | OpenStreetMap Nominatim |
| Deployment | PM2 on Contabo VPS |

---

## Repository Structure

```
Arise/
├── server/              # Express.js API + SQLite backend
│   └── src/
│       ├── index.js     # Main API server (~7500+ lines) — all routes, AI, telemetry, jobs
│       ├── db.js        # Database schema & initialization (17 tables)
│       ├── auth.js      # JWT signing, bcrypt, user lookup
│       ├── mailer.js    # SMTP email config
│       ├── notification-dispatcher.js  # Background email queue worker
│       ├── protrack-token.js           # Protrack 365 auth + token caching
│       ├── fleetApiAuth.js             # Cartrack Fleet API auth
│       ├── fleetApiClient.js           # Cartrack vehicle status fetcher
│       ├── password-reset.js           # Token-based password reset flow
│       └── bootstrap-core-users.js    # Seeds default user accounts
├── web/                 # React SPA frontend
│   └── src/
│       ├── components/  # UI components (AiWorkspaceTab, AssistantChatWidget, etc.)
│       └── pages/       # Page-level components per role
├── mobile/              # Expo React Native app (mirrors web features for drivers)
├── shared/              # Shared code used by both web and mobile
│   ├── api-client/      # Centralized Axios client
│   ├── reports/         # Report builders (Excel, PDF)
│   └── driver-onboarding/  # Onboarding form schema & validation
├── ecosystem.config.js  # PM2 deployment config
└── README.md
```

---

## User Roles

| Role | Access |
|------|--------|
| ADMIN | Full access: fleet, AI workspace, audit console, reports, user management |
| OPS | Operations: order dispatch, assignments, telemetry, article generation |
| DRIVER | Mobile app: trip assignments, fuel logs, performance KPIs, onboarding |
| FUEL | Fuel log management |
| CUSTOMER | Order placement, payment upload, article reading |

---

## Core Features

### Order & Dispatch
- Distance-based dynamic pricing (KES 32,000 base + KES 1,000 per 5 km increment)
- Guest order creation (no account required); upgradeable to customer account
- Order lifecycle: pending → confirmed → dispatched → delivered
- Payment via M-Pesa / bank transfer with reference uploads

### Fleet Telemetry
- Real-time GPS tracking via Protrack 365 or Cartrack Fleet API
- Polled every 60 seconds; stores snapshots to `telemetry_snapshots` table
- Speed alerts (>65 kph by default), idle alerts (>120 min by default)
- Live map view in admin dashboard

### AI Features (5 integration points — all in `server/src/index.js`)

| Feature | Endpoint / Trigger | Purpose |
|---------|-------------------|---------|
| **Daily Article Generation** | `POST /api/admin/articles/generate` + daily scheduler | Auto-generates 400–420 word thought-leadership articles in East African context |
| **Landing Page Chatbot** | `POST /api/chatbot` | Public FAQ assistant (no auth required); answers pricing, payment, sand stock queries |
| **Admin Ops Copilot** | `POST /api/admin/ai/chat` | ADMIN-only chat assistant with live context (telemetry, alerts, orders, costs) |
| **Telemetry Anomaly Detection** | Background job every 5 min | Detects route anomalies, unexpected stops, speed patterns; stores to `telemetry_ai_alerts` |
| **Image Audit / Receipt Verification** | Triggered on fuel log & cost uploads | Compares uploaded receipt images against expected values using vision API |

All AI features degrade gracefully if no AI provider is configured (static fallbacks, skipped jobs).

### Reporting
- Scheduled reports (Excel / PDF): stocks, driver earnings, truck performance, AI insights, speeding alerts
- Configurable delivery channels (email, Telegram)
- P&L breakdown, per-truck financials, timeseries views

### Audit & Compliance
- Duplicate cost/fuel log detection
- AI-based receipt image verification (vision model)
- Audit flag console for ADMIN review

---

## Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| `users` | Accounts with roles |
| `orders` | Customer orders |
| `assignments` | Truck-to-order assignments |
| `trucks` | Fleet vehicles |
| `drivers` | Driver profiles with document paths |
| `telemetry_snapshots` | GPS/speed/idle data per truck |
| `telemetry_ai_alerts` | AI-detected fleet anomalies |
| `ai_audit_flags` | Compliance flags from receipt audits |
| `articles` | AI-generated published articles |
| `costs` | Expense records with audit tracking |
| `fuel_logs` | Fuel consumption records |
| `stock` / `stock_tx` | Sand inventory (coarse/smooth) |
| `notifications` | Email queue |
| `report_schedules` | Scheduled report delivery config |
| `password_resets` | Token-based reset tracking |

---

## AI Configuration (Environment Variables)

```env
# Provider selection
AI_BASE_URL=          # Local LLM endpoint (e.g. http://localhost:11434/v1)
AI_API_KEY=           # Key for local endpoint (or leave blank for Ollama)
OPENAI_API_KEY=       # Set this for cloud OpenAI; takes priority

# Model overrides per feature
AI_MODEL=             # Default / telemetry model
OPENAI_ARTICLE_MODEL= # Article generation model
OPENAI_INSIGHTS_MODEL=# Telemetry insights / admin chat model
TELEMETRY_AI_MODEL=   # Telemetry anomaly detection model
OPENAI_AUDIT_MODEL=   # Receipt image audit model
OPENAI_CHATBOT_MODEL= # Public chatbot model

# Behavior tuning
TELEMETRY_AI_ANALYSIS_INTERVAL_MS=300000  # How often to run anomaly detection
TELEMETRY_AI_LOOKBACK_MINUTES=240         # History window for analysis
TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE=0.55  # Confidence threshold
AI_CONTEXT_CACHE_MS=45000                 # Live context cache TTL
AI_CHAT_TIMEOUT_MS=12000                  # Admin chat request timeout
DISABLE_AUTO_ARTICLES=0                   # Set to 1 to disable scheduler
```

---

## Running the Project

```bash
# Backend
cd server && cp .env.example .env && npm install && npm run seed && npm start

# Web frontend
cd web && npm install && VITE_API_BASE=http://localhost:4000 npm run dev

# Mobile
cd mobile && cp .env.example .env && npm install && npm start
```

---

## Key Notes

- All AI logic is centralized in **`server/src/index.js`** — no separate AI service
- The OpenAI SDK is used but is fully compatible with local OpenAI-compatible servers (Ollama, LocalAI, LM Studio, etc.) — just set `AI_BASE_URL`
- Model name env vars still use `OPENAI_*` prefixes for historical reasons but are provider-agnostic
- The `.env.example` defaults show `gpt-4o-mini` / `gpt-5-nano` as model names — these should be replaced with your local model names when running against a local server
