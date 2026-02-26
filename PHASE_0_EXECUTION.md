# Phase 0 — Foundations: Execution Plan (User Platform)

Last updated: 2025-10-23

This is the step-by-step plan and checklist to deliver Phase 0. It complements `PROGRESS.md` and focuses on decisions, tasks, and clear Definitions of Done (DoD).

---

## 1) Decisions to Lock (Non‑Negotiables)

- **D1. Route prefix**: ✅ Use `/u/*` for all User Platform routes (avoids `/api/*` → EVI rewrite in production).
- **D2. Job capture mode**: ☐ Decide now
  - Wrapper (recommended): Frontend calls `/u/pipeline/run` (and fix/deploy wrappers). Server records `{ user_id, prompt, network }`, calls EVI, stores `job_id`, returns response.
  - Attach (fallback): Frontend calls EVI directly, then immediately `POST /u/jobs/attach` with `{ job_id, prompt, ... }`.
- **D3. Session model**: ✅ Cookie-based sessions. HttpOnly, Secure, SameSite=Strict (or Lax if cross-subdomain). Opaque tokens; server stores hashes only; refresh rotation.
- **D4. Redis usage**: ✅ Required for OTP rate limits and short‑TTL `/u/user/me` cache.
- **D5. RBAC & Premium**: ✅ Roles `normal|pro|admin`. Admin‑minted Premium Keys to upgrade to `pro` (revocable).

---

## 2) Provisioning & Wiring

- **Databases** (see schema in `PROGRESS.md`)
  - **PostgreSQL** (Railway) — primary relational store.
  - **Redis** (Railway/Upstash) — rate limits and short‑lived caches.
- **Secrets**
  - `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `APP_URL`.
  - OTP provider: `OTPLEAA_*` (or equivalent), and email rail (e.g., `BREVO_API_KEY`).

DoD
- **[ ]** DB and Redis provisioned; env vars captured.
- **[ ]** App boots locally with DB and Redis reachable; health endpoints return 200.
- **[ ]** `/u/*` routes reachable locally without colliding with `/api/*`.

---

## 3) Schema (Freeze & Migrate)

Tables (minimum for Phase 0)
- `users`, `sessions`, `entitlements`, `premium_keys`, `user_jobs`, `job_cache`, `audit_logs`.
Key rules
- `users.email` unique (case‑insensitive recommended).
- `sessions` store only token hashes (`session_hash`, `refresh_hash`).
- `premium_keys.secret_hash` only; never store raw key.
- `user_jobs.prompt` required for pipeline; optional for fix.
- `job_cache` holds denormalized fields needed by dashboards.

DoD
- **[ ]** Migrations apply cleanly on a clean DB.
- **[ ]** Seed script creates an admin user and baseline entitlements.

---

## 4) Auth Core (Server Only)

Endpoints
- **POST `/u/auth/send-otp`**
  - Normalize identity (Phase 0: email recommended; phone optional).
  - Redis RL: per identity (e.g., 5/15m) + per IP (e.g., 20/15m).
  - Call OTP provider (otpleaa) to create challenge; never store OTP. Deliver via email rail (e.g., Brevo template).
  - Response: `{ ok: true }` (429 on RL).
- **POST `/u/auth/verify`**
  - Redis RL: verify attempts (e.g., 10/15m).
  - Verify via otpleaa → on success: upsert user, create session, set cookies (`evium_access` ~90m, `evium_refresh` ~30d, rotated), write audit logs.
- **POST `/u/auth/logout`**
  - Revoke session (`revoked_at`), clear cookies, write audit log.
- **GET `/u/user/me`**
  - Validate `evium_access` cookie → return `{ user, role, entitlements, counts }`.
  - Redis cache: `sess:me:{session_hash}` for ~60s.

Cookie policy
- Names: `evium_access` (short), `evium_refresh` (long), optional `evium_csrf`.
- Flags: HttpOnly, Secure, SameSite=Strict (or Lax if cross‑subdomain), Path=/.
- Rotation: on verify/refresh; revoke on logout or privilege changes.

DoD
- **[ ]** OTP send respects RL; returns 429 beyond thresholds.
- **[ ]** Verify issues both cookies; `/u/user/me` returns user payload.
- **[ ]** Logout clears cookies and revokes session.

---

## 5) RBAC & Premium Keys

Middleware
- `requireAuth`, `requireRole('pro')`, `requireRole('admin')`.

Endpoints
- **POST `/u/admin/premium-keys`** (mint)
- **POST `/u/admin/premium-keys/redeem`** (upgrade to pro)
- **POST `/u/admin/premium-keys/revoke`** (revoke entitlements)

DoD
- **[ ]** Non‑admin calls denied with consistent error shape.
- **[ ]** Upgrades reflect in `/u/user/me` immediately; cache invalidated.
- **[ ]** Audit entries for mint/redeem/revoke.

---

## 6) User↔Job Mapping (Spine for Dashboards)

Decision: D2 Wrapper vs Attach
- **Wrapper (preferred)**: implement `/u/pipeline/run` etc. to attach prompt/user before calling EVI.
- **Attach (fallback)**: call `/u/jobs/attach` immediately after EVI returns `job_id`.

Background reconcile
- Sweep recent `user_jobs` where `job_cache` is stale/empty.
- Update from EVI:
  - `GET /api/job/:id/status?verbose=1` → state, progress, address, fqName, args, timestamps.
  - If completed, `POST /api/verify/byJob` → `verified`, `explorer_url`.

DoD
- **[ ]** Every new run creates a `user_jobs` row with correct `job_id` + prompt.
- **[ ]** `job_cache` backfilled within minutes.
- **[ ]** `/u/user/me` counts reflect completed jobs.

---

## 7) Read APIs for Dashboard

Endpoints (read‑only)
- **GET `/u/jobs?state=&type=&cursor=`** — server‑paginated; hydrate from `job_cache`.
- **GET `/u/jobs/:jobId`** — detailed view; include cached verify status.

DoD
- **[ ]** Pagination is stable at scale.
- **[ ]** Only caller’s jobs are returned (auth enforced).
- **[ ]** Each list item includes: `jobId`, `created_at`, `state`, `address?`, `fqName?`, `verified`, `explorerUrl?`.

---

## 8) Email OTP Delivery (Provider: Brevo; Verifier: otpleaa)

- Use a branded sender domain; configure SPF/DKIM/DMARC.
- Create a transactional OTP template (HTML + plain‑text). Disable tracking.
- Suggested params: `{ otp, ttlMinutes, appDomain, supportUrl }`.
- Tags: `["otp","auth"]`; headers include idempotency (`X-Idempotency-Key`) and request id.
- Rate limits as in section 4; add CAPTCHA (Turnstile/hCaptcha) to `/u/auth/send-otp`.

DoD
- **[ ]** OTP emails deliver reliably to inbox (seed tests pass; no spam folder).
- **[ ]** No OTP stored in logs/DB; only `challenge_id` and metadata.
- **[ ]** Brevo webhooks configured for bounces/complaints (optional suppression list).

---

## 9) Security & Observability (Phase‑0 scope)

Security
- CSRF: require `X-CSRF-Token` for mutating `/u/*` routes.
- Session rotation on role/entitlement changes (Phase‑0+ recommended).
- PII minimization; encrypt sensitive metadata if any.

Observability
- Structured logs with `request_id`, client IP, rate‑limit decisions, auth events.
- Metrics: OTP send/verify counts, 401/429 rates, reconcile errors.
- Health endpoints for DB/Redis/OTP provider reachability.

DoD
- **[ ]** Security review checklist closed.
- **[ ]** Basic dashboards/alerts for OTP spikes and reconcile failures.

---

## 10) Environment Variables (Phase 0)

- `DATABASE_URL` — Postgres
- `REDIS_URL` — Redis
- `SESSION_SECRET` — token gen/HKDF
- `APP_URL` — cookie domain/origin
- `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY` — otpleaa
- `BREVO_API_KEY` — email rail (or other provider key)

DoD
- **[ ]** `.env.local.example` committed with placeholders and comments.
- **[ ]** Railway prod envs configured and documented.

---

## 11) Implementation Order (Step‑by‑Step)

1) Infra & env
- **[ ]** Provision Postgres + Redis; set envs locally.
- **[ ]** Add `.env.local.example` and "Cookie Policy & TTLs" doc.
2) Migrations
- **[ ]** Choose ORM (Prisma/Drizzle). Implement schemas; run migrate; add seed admin.
3) Routing skeleton
- **[ ]** Add `/u/*` route group; health checks for DB/Redis/provider.
4) Auth core
- **[ ]** Implement `/u/auth/send-otp`, `/u/auth/verify`, `/u/auth/logout`, `/u/user/me`.
- **[ ]** Cookies issuance; RL middleware; audit logs.
5) RBAC & keys
- **[ ]** Middlewares; admin endpoints; cache invalidation.
6) Job mapping (pick D2 mode)
- **[ ]** Implement wrapper/attach; reconcile worker; update `job_cache`.
7) Read APIs
- **[ ]** `/u/jobs` and `/u/jobs/:jobId` with pagination and auth.
8) Hardening
- **[ ]** CSRF, logging, metrics, alerts, backup plan.

---

## 12) Open Questions (Confirm Before Coding)

- **D2**: Wrapper vs Attach for job capture?
- **ORM**: Prisma or Drizzle?
- **Email domain**: Which From domain to authenticate with Brevo (SPF/DKIM/DMARC)?
- **Cross‑domain**: Any subdomain constraints impacting SameSite? (Strict vs Lax)
- **CAPTCHA**: Turnstile/hCaptcha preference?

---

## 13) Definitions of Done (Roll‑up)

- **Auth core live**: send‑otp, verify, logout, me with secure cookies and RL.
- **DB schemas**: created and seeded; tokens stored as hashes.
- **Routing**: `/u/*` resolvable in local and prod; no `/api/*` collision.
- **Security**: CSRF header enforced; PII minimized; secrets managed.
- **Observability**: request IDs, RL denials, auth lifecycle, basic health checks.
- **Email delivery**: OTP template sending via Brevo; deliverability verified.
