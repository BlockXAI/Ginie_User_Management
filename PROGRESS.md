# EVI User Management Platform — Progress & Foundations (Phase 0)

Last updated: 2025-10-23

---

## 1. Executive Summary

### Goal
Add a secure, reusable user platform on top of Camp V3/EVI V4 that provides passwordless OTP auth, durable sessions, RBAC/entitlements, and user-owned history of EVI jobs, logs, artifacts, verify/audit/compliance.

### Phase 0 Deliverables (current)
- Core DB schema online (Postgres) and Redis connected for rate limits.
- Auth endpoints live: `POST /u/auth/send-otp`, `POST /u/auth/verify`, `POST /u/auth/logout`, `GET /u/user/me`, `GET /u/healthz`.
- Cookies issued on verify (HttpOnly, Secure, SameSite=Strict) + CSRF cookie (`evium_csrf`) for write routes.
- Redis-backed rate limits for OTP send/verify.
- Audit logs on auth lifecycle and jobs attach.
- Job ownership + read APIs: `POST /u/jobs/attach`, `POST /u/jobs/cache`, `GET /u/jobs`, `GET /u/jobs/:jobId`.
- Basic metrics via `GET /u/metrics` + Sentry error reporting.
- Refresh endpoint: `POST /u/auth/refresh` rotates access/refresh cookies and CSRF.
- Admin lookup: `GET /u/admin/user/lookup?email=...|id=...` (requires admin), for operator workflows.

### Routing Strategy
Use prefix `/u/*` for User API to avoid collision with existing Next.js production rewrite of `/api/*` → EVI backend.

---

## 2. System Architecture

### Overview
- **Frontend**: Next.js App Router (Camp V3 UI). Adds login/verify forms, `UserProvider`, protected routes.
- **User API** (this project): OTP auth, sessions, profiles, entitlements, user↔job mapping, admin premium keys.
- **EVI Backend**: Unchanged; remains the source for job status, logs (SSE), artifacts, verify/audit/compliance. We attach a `user_id` to each created job in our DB for history and dashboards.

### Datastores
- **Postgres (Railway)**: primary relational store for users, sessions, entitlements, premium keys, user_jobs, job_cache, audit_logs.
- **Redis (Railway/Upstash)**: cache/rate-limiter for OTP throttles, `/me` cache, and optional blacklists.

---

## 3. Database Design

### Database Count & Choice

#### How many databases?
- **One primary relational DB**: PostgreSQL (Railway) for durable data and relational integrity.
- **One cache/limiter**: Redis for rate limits and short-lived caches.

#### Recommended Stack
- **PostgreSQL 15+** (Railway): Widely supported, strong JSONB support, robust indexing, Prisma/Drizzle compatible.
- **Redis 6+**: Atomic counters (INCR/EXPIRE), fast TTL caches, sliding window rate limiting.

#### Alternatives
- If Redis is unavailable, minimal Phase 0 can emulate simple limits in Postgres (less accurate under concurrency). Redis remains strongly recommended.

### Schema (Phase 0)

> Logical schema focuses on auth/session and minimum history linkage. All timestamps are UTC.

#### users
- `id UUID PK`
- `email TEXT UNIQUE` (or `CITEXT` for case-insensitive)
- `email_verified_at TIMESTAMP NULL`
- `display_name TEXT NULL`
- `wallet_address TEXT NULL`
- `role TEXT NOT NULL DEFAULT 'normal'` — enum: `normal|pro|admin`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`
- `updated_at TIMESTAMP NOT NULL DEFAULT now()`

Indexes: `(email)`, `(role)`

#### sessions
- `id UUID PK`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `session_hash TEXT UNIQUE NOT NULL` — hash of opaque session token stored in cookie
- `refresh_hash TEXT UNIQUE NULL` — hash of refresh token (if stored server-side)
- `expires_at TIMESTAMP NOT NULL`
- `device_info JSONB NOT NULL DEFAULT '{}'`
- `ip INET NULL`
- `last_active_at TIMESTAMP NULL`
- `revoked_at TIMESTAMP NULL`

Indexes: `(user_id)`, `(expires_at)`, `(session_hash)`

#### entitlements
- `user_id UUID PK REFERENCES users(id) ON DELETE CASCADE`
- `pro_enabled BOOLEAN NOT NULL DEFAULT false`
- `wallet_deployments BOOLEAN NOT NULL DEFAULT false`
- `history_export BOOLEAN NOT NULL DEFAULT false`
- `chat_agents BOOLEAN NOT NULL DEFAULT false`
- `hosted_frontend BOOLEAN NOT NULL DEFAULT false`
- `limits JSONB NOT NULL DEFAULT '{}'` — e.g., `{ "daily_jobs": 100 }`

Indexes: `(user_id)`

#### premium_keys
- `id UUID PK`
- `secret_hash TEXT NOT NULL` — bcrypt/argon2 hash of the opaque key
- `issued_by_admin UUID NOT NULL REFERENCES users(id)`
- `status TEXT NOT NULL` — enum: `minted|redeemed|revoked`
- `redeemed_by_user UUID NULL REFERENCES users(id)`
- `expires_at TIMESTAMP NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

Indexes: `(status)`, `(expires_at)`

#### user_jobs
- `job_id TEXT PK` — EVI job identifier
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `type TEXT NOT NULL DEFAULT 'pipeline'` — `pipeline|fix|deploy_erc20|audit|compliance`
- `prompt TEXT NULL` — store the prompt at creation time (EVI doesn't echo it back)
- `filename TEXT NULL` — for fix/compile paths
- `network TEXT NOT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

Indexes: `(user_id, created_at DESC)`, `(type, created_at DESC)`

#### job_cache
- `job_id TEXT PK`
- `state TEXT NOT NULL` — `queued|running|failed|completed`
- `progress INTEGER NOT NULL DEFAULT 0`
- `address TEXT NULL`
- `fq_name TEXT NULL`
- `constructor_args JSONB NOT NULL DEFAULT '[]'`
- `verified BOOLEAN NOT NULL DEFAULT false`
- `explorer_url TEXT NULL`
- `completed_at TIMESTAMP NULL`
- `updated_at TIMESTAMP NOT NULL DEFAULT now()`

Indexes: `(state)`, `(updated_at DESC)`

#### audit_logs
- `id UUID PK`
- `user_id UUID NULL REFERENCES users(id)`
- `event TEXT NOT NULL` — e.g., `auth.login`, `auth.logout`, `auth.otp.send`, `auth.otp.verify`, `role.upgrade`, `key.redeem`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMP NOT NULL DEFAULT now()`

Indexes: `(user_id, created_at DESC)`, `(event, created_at DESC)`

---

## 4. Session Management

### Cookies & Session Model

#### Cookie names
- Access cookie: `evium_access`
- Refresh cookie: `evium_refresh`

#### Flags
`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` (set `Domain` to parent domain if subdomains are used)

#### TTLs
- Access: 60–120 minutes (Phase 0 target: 90 minutes)
- Refresh: 30 days (rotated on use)

#### Contents
- Access: opaque random token (not JWT), validated by `sessions.session_hash` (hashed server-side)
- Refresh: opaque random token; rotated and hashed into `sessions.refresh_hash` on each refresh

#### Rotation
- On `/u/auth/verify`: issue both cookies
- On silent refresh: verify refresh, issue new access + new refresh, invalidate previous refresh (rotate)
- On logout: clear cookies, mark session `revoked_at` and invalidate refresh

#### CSRF
- With `SameSite=Strict`, CSRF risk is reduced; still require `X-CSRF-Token` header for mutating `/u/*` routes
- CSRF token can be stored in a non-HttpOnly cookie `evium_csrf` and mirrored in a header

### Redis Usage & Rate Limits

#### Namespaces (examples)
- OTP send per identity: `rl:otp:send:{identity}` → counter (TTL 15m), limit e.g., 5/15m
- OTP send per IP: `rl:otp:send:ip:{ip}` → counter (TTL 15m), limit e.g., 20/15m
- OTP verify per identity: `rl:otp:verify:{identity}` → counter (TTL 15m), limit e.g., 10/15m
- `/u/user/me` cache: `sess:me:{session_hash}` → JSON blob, TTL 60s
- Optional abuse signals: `abuse:identity:{identity}`, `abuse:ip:{ip}`

#### Algorithm
Fixed/sliding window using `INCR` with `EXPIRE`. On first increment, set expiry. Deny when count exceeds limit.

#### Why Redis
Atomic counters at scale; avoids row-level locks and hot rows in Postgres under spikes.

---

## 5. Authentication

### Auth Flows (Phase 0)

#### 1) Send OTP — `POST /u/auth/send-otp`
**Request**: `{ "identity": "email-or-phone" }`

**Behavior**:
- Normalize and validate identity; for Phase 0, email-only is acceptable.
- Apply Redis rate limits (per identity, per IP). If exceeded, respond 429.
- Call provider (otpleaa) to generate and deliver OTP; store only a provider `challenge_id` if needed (do NOT store OTP).
- Return `{ ok: true }` (always 200 for privacy; consider 429/400 for strict API clients).

**Responses**:
- `200 { ok: true }`
- `429 { ok: false, error: { code: "rate_limited" } }`

#### 2) Verify OTP — `POST /u/auth/verify`
**Request**: `{ "identity": "email-or-phone", "otp": "123456" }`

**Behavior**:
- Normalize identity; apply rate limits.
- Call provider to verify OTP.
- If valid, lookup/create `users` row (upsert on `email`).
- Generate opaque tokens (access, refresh); store hashes in `sessions`.
- Set cookies (HttpOnly, Secure, SameSite=Strict).
- Emit audit log (`auth.otp.verify`).

**Responses**:
- `200 { ok: true, user: { id, email, role, entitlements } }`
- `401 { ok: false, error: { code: "invalid_otp" } }`
- `429 { ok: false, error: { code: "rate_limited" } }`

### Routes (Phase 0)

#### GET /u/healthz
Returns service health and dependencies (Postgres, Redis, OTP provider).

#### GET /u/user/me
- Validate access cookie → session → user
- Cache result in Redis (60s)
- Return user profile + role + entitlements

#### POST /u/auth/refresh
- Validate refresh cookie
- Rotate tokens (new access, new refresh)
- Invalidate old refresh
- Update cookies

#### POST /u/auth/logout
- Clear cookies
- Mark session revoked
- Emit audit log

#### POST /u/jobs/attach
- Link job to authenticated user
- Store prompt/metadata

#### POST /u/jobs/cache
- Update job state from EVI polling
- Cache completed job metadata

#### GET /u/jobs
- List user's jobs with pagination
- Filter by type, state, date range

#### GET /u/jobs/:jobId
- Get specific job + cached metadata
- Verify ownership

#### GET /u/admin/user/lookup
- Admin-only: lookup by email or ID
- Return profile + entitlements

#### GET /u/metrics
- Export Prometheus-style metrics
- Auth rates, session counts, job stats

### Security Measures

#### General
- CSRF: double-submit token or same-site strict + per-request header.
- OTP abuse: exponential back-off, cool-downs, fraud signals.
- Device binding (optional): soft fingerprint for unusual-login checks.

#### Enterprise Controls
- Strict cookie flags; CSRF protections; OTP rate limiting; brute-force lockouts.
- Session rotation on privilege changes; revoke everywhere on logout.
- PII minimization; encrypt sensitive fields; hashed tokens and keys.

---

## 6. Authorization & Access Control

### Server (authoritative)
API middleware enforces:
- `requireAuth` (any authenticated user)
- `requireRole('pro')` for premium features (wallet deploy, history export)
- `requireRole('admin')` for premium key mint/revoke

### Frontend
- `UserProvider` + `useUser()`: `user`, `role`, `entitlements`, `loading`.
- Guards:
  - `ProtectedRoute` (auth required)
  - `RequirePro` (gates premium UI)
  - `RequireAdmin` (admin console)

### Caching
- `/user/me` cached in Redis (15–60s) and in client state (React Query/SWR).
- Invalidate on login/logout/role change.

---

## 7. Premium Features

### Mapped to EVI surfaces

#### 1. Wallet-based deployments
- If `pro`: enable "Deploy with wallet" path; show wallet connect + **client-side signature**; backend still owns job creation, tags job with `user_id`.
- Persist `wallet_address` on profile for explorer context.

#### 2. User history & retrieval
- Dashboard: **My Jobs** = list by `user_id` with server pagination.
- "Open artifacts": call **`GET /api/artifacts?...`** for `sources|abis|scripts|audit|compliance` using the stored `job_id`.
- "Open logs": stream **SSE** via `/api/job/:id/logs/stream`.
- "Verify": call `/api/verify/byJob` → **explorerUrl** to Blockscout.
- All of the above are clearly supported in your V4 docs (jobId, SSE, artifacts, verify), so the dashboard is simply **composition** over those endpoints.

#### 3. Chat-based intersections with agents
- "Start chat" opens/continues a `chat_session`; each "run" produces or links to an **EVI pipeline or fix job**, capturing `job_id` back to the session for **navigable provenance** (prompts → jobs → artifacts).
- This aligns with your **multi-agent** architecture and streamed orchestration; your deck shows an agent cluster (deploy, analysis, info, compliance) behind a conversational surface.

#### 4. Basic hosted dApp frontend
- For verified deployments: populate a **scaffold** on a premium subdomain, showing contract metadata, ABI-driven forms, and **Verify on explorer** links (the verify endpoints & explorer URL guidance are already standard in V4).

### Admin lifecycle for premium upgrades

#### Flows
- **Mint key**: Admin console issues "Premium Key" (one-time, expirable).
- **Deliver key**: Sent to the user (secure channel).
- **Redeem key**: User posts key; service validates, upgrades to `pro`, activates entitlements, writes audit trail.
- **Revoke**: Admin can revoke entitlements or key; sessions for that user are rotated.
- **Observe**: Admin sees usage dashboards (deploy counts, audit/compliance runs, last login).

#### Hardening
- Keys stored **hashed** (Argon2/bcrypt), never reversible; one-shot redeem; short expiry; org scope ready (future).

---

## 8. User Interface

### User Dashboard Components

#### Overview
- current role/plan; quick upgrade state; recent activity.

#### My Jobs
- reverse-chronological jobs with state, progress, **address**, **fqName** (when available), **network**. (All fields are exposed in the V4 job status result.)

#### Logs (live)
- attach **SSE** stream while jobs run.

#### Artifacts
- sources/ABIs/scripts download; audit/compliance report viewers.

#### Verify
- "Verify on explorer" button wired to `/api/verify/byJob` → shows returned **explorerUrl**.

#### Chat Sessions
- prompts ↔ jobs lineage; resume chat.

#### Billing/Usage (later)
- quotas, limits, export CSV.

---

## 9. Implementation Roadmap

### Phase 0 – Foundations (1 week)
- Migrations: users, sessions, roles, entitlements, premium_keys, jobs(audit index), audit_logs.
- Service layout: Gateway, Auth, Identity; otpleaa config; Redis.
- `/auth/send-otp`, `/auth/verify`, `/auth/logout`, `/user/me`.

### Phase 1 – Roles & Premium (1 week)
- Role enforcement middleware.
- Premium keys: mint, redeem, revoke + admin UI.
- Entitlements in `/user/me` and caches.

### Phase 2 – EVI history & dashboard (1–2 weeks)
- Attach `user_id` at job creation (or map by session when initiating pipeline/fix).
- "My Jobs" list; **SSE logs**, **Artifacts**, **Verify** button with returned **explorerUrl**. (All supported as per V4.)

### Phase 3 – Wallet deployments & chat agents (1–2 weeks)
- Wallet link + client-signed deploy path (pro-only).
- Chat sessions table + lineage to `job_id`.

### Phase 4 – Hardening & ops (1 week)
- Rate limits, CSRF, session rotation, audit stream.
- Metrics dashboards; backups; failover tests.

### Phase 5 – Packaging for reuse (1 week)
- Publish a thin **frontend SDK** (`UserProvider`, `useUser`, guards, `/me` fetcher).
- OpenAPI & typed client for server integrations.

---

## 10. Operational Excellence

### Observability
- Request IDs; structured logs; auth/audit event stream.
- Metrics: OTP sends, verifications, session churn, job creation per user, SSE error rates.

### Reliability
- DB backups & restore drills; zero-downtime schema migrations.
- Idempotency keys on auth and profile updates.
- Canary deploys; health checks.

### Compliance
- Audit logs on role/entitlement changes.
- Data retention and export/delete workflows.

---

## 11. Risk Management

### Risk Checklist & Mitigations
- **SSE reliability**: add polling fallback and "last index" resume. (Your docs already show SSE events and usage patterns.)
- **Artifact drift**: always read artifacts by `jobId` using the documented routes; log if missing.
- **Verify fragility**: use the **verify-by-job** endpoint that runs in the same sandbox and returns the **explorerUrl**; retry on explorer lag.
- **Scaling OTP**: strict rate limits + staged email providers; store anti-abuse signals.

---

## 12. Strategic Alignment

### Why this aligns with your stack
- The **multi-agent EVI architecture** and orchestration lifecycle (generate → fix → deploy → verify → audit/compliance → artifacts + logs) is already standardized; you're **adding identity and entitlements** on top, not re-inventing the engine.
- The **V4 API guide** confirms stable endpoints and shapes for jobs, logs (SSE), artifacts, verify, audit/compliance—exactly what you need to implement **history**, **retrieval**, and **one-click verify** in a user dashboard.

---

## 13. Final Takeaways

- Treat "user management" as its **own product**: OTP auth, sessions, roles, entitlements, admin-minted premium keys, and dashboards.
- Your **user_id** becomes the **join key** across **jobs**, logs, artifacts, and verify/audit/compliance reports.
- **Pro** is simply a **role + set of entitlements**—no product rewrites required.
- Build it once, ship a **thin SDK**, and reuse it across every app or agent surface you spin up.

If you want, I can turn this into a one-page **target operating model** (RACI, SLOs, env variables, and runbooks) so your team can execute the rollout cleanly next.