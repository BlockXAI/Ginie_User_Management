# Phase 1 Execution — RBAC, Premium Keys, Entitlements, Pro Gating

This is the implementation blueprint for Phase 1. It specifies objectives, data/authZ models, endpoints, guards, tests, rollout, and runbooks. No code here—use this as a checklist and source of truth while implementing.

---

## Objectives (Definitions of Done)

- Authorization enforced via roles and entitlements:
  - Roles: `normal`, `pro`, `admin` (column `users.role`).
  - Entitlements (row per user): `pro_enabled`, `wallet_deployments`, `history_export`, `chat_agents`, `hosted_frontend`, `limits` (jsonb quotas).
- Upgrade flow live:
  - Admin mints one-time opaque key (hash stored only). User redeems to upgrade role/entitlements. Fully audited, rate-limited, access rotates.
- Pro features gated server-side:
  - API checks at proxy boundaries (before upstream), UI guards optional.
- Admin operations:
  - Admin lookup (exists), key mint/revoke/list, optional direct entitlement update.
- Observability:
  - Structured logs; counters for keys/role changes; Sentry optional.
- Docs & tests:
  - API docs, Admin Upgrade Runbook, Support Runbook; smoke + negative tests scripted.

---

## Scope & Surfaces

- Backend (User API)
  - RBAC middleware: `requireAuth`, `requireRole`, `requireEntitlement`.
  - Premium key lifecycle: mint → redeem → revoke (+ list).
  - Optional: admin user entitlement update.
  - Pro-feature gating at API boundaries (wrapper/proxy routes).
  - Audits, rate limits, metrics counters.
- Database
  - Use existing `premium_keys`, `entitlements`. Add indexes if needed.
- Frontend
  - `UserProvider` continues calling `/u/user/me`.
  - `RequirePro`, `RequireAdmin` guards.
  - Minimal Admin Console: Users lookup, Keys management.
- Ops
  - Rollout plan, flags, and runbooks.

---

## Data & AuthZ Model

- Roles: `normal` < `pro` < `admin`.
- Entitlements (per user):
  - `pro_enabled` (bool) — master switch for pro.
  - `wallet_deployments`, `history_export`, `chat_agents`, `hosted_frontend` (bools).
  - `limits` (jsonb): quotas like `{ "daily_jobs": 25 }`.
- Premium Keys (`premium_keys`):
  - `id`, `secret_hash`, `status` (minted|redeemed|revoked),
  - `issued_by_admin`, `redeemed_by_user?`, `expires_at?`, `created_at`.
  - Never store plaintext key; show once at mint.

---

## Work Breakdown Structure (WBS)

A) DB & Migrations
- Confirm schemas are present (already in Phase 0). Add/ensure indexes:
  - `premium_keys(status)`, `premium_keys(expires_at)`, `entitlements(user_id PK)` present.
- DoD: Migrations apply cleanly (dev/staging); Prisma types compile (if used).

B) Backend Authorization Layer
- Implement middleware:
  - `requireAuth` — validates session (like `/u/user/me`).
  - `requireRole(role)` — allows equal-or-higher.
  - `requireEntitlement(flag)` — checks entitlements row.
- Apply guards to Phase 1 endpoints (matrix below).
- DoD: 401 for unauth, 403 for insufficient role; logs include route, user_id, decision.

C) Premium Key Lifecycle
- Endpoints
  - `POST /u/admin/keys/mint` (admin)
    - Body: `{ expiresAt?: string }`
    - Generates opaque key (≥32 rand bytes, base64url), stores `secret_hash`, `status='minted'`, optional `expires_at`.
    - Response: `{ ok: true, key, id }` (show key once), audit `key.mint`.
  - `POST /u/keys/redeem` (auth)
    - Body: `{ key: string }`
    - Constant-time hash compare; check `status`, `expires_at`.
    - On success: set `status='redeemed'`, `redeemed_by_user`, upgrade user role/entitlements.
    - Rotate session (call our refresh logic) so role is effective immediately.
    - Audits: `key.redeem`, `role.upgrade`, `entitlements.update`.
  - `POST /u/admin/keys/revoke` (admin)
    - Body: `{ id: string }` → set `status='revoked'`, audit `key.revoke`.
  - `GET /u/admin/keys?status=&limit=` (admin, optional)
    - For ops visibility.
- Security
  - Rate-limit `redeem` by user identity and IP.
  - Generic 4xx messages on invalid/expired/revoked/double redeem.

D) Pro-Feature Enforcement (Server first)
- Enforce at proxy boundaries before upstream calls:
  - `/u/proxy/wallet/deploy` → `requireEntitlement('wallet_deployments')`.
  - `/u/history/export` → `requireEntitlement('history_export')`.
  - `/u/chat/*` → `requireEntitlement('chat_agents')`.
  - `/u/frontend/*` → `requireEntitlement('hosted_frontend')`.
- Quotas via `entitlements.limits` if configured.
- DoD: Non-pro → 403, logged.

E) Admin Console (Minimal UI)
- Users page: lookup by email; view role & entitlements; (optional) toggle entitlements.
- Keys page: mint, list, revoke; copy key (shown once on mint).
- Guards: `RequireAdmin` for console routes.

F) Frontend Guards & Refresh Flow
- `RequirePro` wrapper gates pro routes/components.
- On 401: `POST /u/auth/refresh` then retry.
- Account menu reflects role from `/u/user/me`.

G) Observability & Security
- Metrics counters: `keysMint`, `keysRedeem`, `keysRevoke`, `roleUpgrade`, `roleDowngrade`, `entitlementsUpdate`.
- Structured logs already on; propagate request id.
- Sentry optional; enable DSN to capture exceptions.
- Rate limits:
  - `redeem`: e.g., 10/15m per identity; 50/15m per IP.

H) Docs & Runbooks
- Update `user-api/docs/API.md` with endpoints, authz rules, error codes.
- Add `Admin_Upgrade_Runbook.md` (mint key → deliver → user redeem → verify pro).
- Add `Support_Runbook.md` (lookup user, optional toggle entitlements).

---

## Endpoint Matrix (with guards)

- `POST /u/admin/keys/mint` — `requireRole('admin')` — create key; return opaque once.
- `POST /u/keys/redeem` — `requireAuth` + RL — upgrade to pro; set entitlements; rotate session.
- `POST /u/admin/keys/revoke` — `requireRole('admin')` — revoke unused key.
- `GET /u/admin/keys?status=&limit=` — `requireRole('admin')` — ops view.
- `GET /u/admin/user/lookup` — `requireRole('admin')` — support lookup (already implemented).
- `POST /u/admin/users/:id/entitlements` — `requireRole('admin')` — optional direct toggle.
- Pro routes (server enforcement, add in later phase if not in this phase):
  - `/u/proxy/wallet/deploy` — `requireEntitlement('wallet_deployments')`.
  - `/u/history/export` — `requireEntitlement('history_export')`.
  - `/u/chat/*` — `requireEntitlement('chat_agents')`.
  - `/u/frontend/*` — `requireEntitlement('hosted_frontend')`.

All POST-like routes: require CSRF header + cookie (Phase 0 behavior).

---

## Test Plan

Positive
- Mint → Redeem → Upgrade visible in `/u/user/me` (role `pro`, entitlements updated).
- Session rotates after redeem; UI/clients see new role immediately.
- Pro feature call (when implemented) returns 2xx for entitled user.

Negative/Abuse
- Wrong key → 4xx; RL increments.
- Revoked/expired key → 400/409.
- Double redeem → 409.
- Non-pro hitting pro routes → 403.
- Missing CSRF on write → 403.
- Non-admin using admin endpoints → 403.

Resilience
- 401 → `/u/auth/refresh` → retry succeeds.
- Metrics increment on mint/redeem/revoke; audits written for each action.
- Sentry captures forced error (if enabled).

---

## Rollout Plan

Stage 0 — Branch & Flags
- Feature branch `phase-1-premium`.
- Hide admin console link behind `ADMIN_UI_ENABLED` until stable.

Stage 1 — Dev
- Implement RBAC, keys endpoints, and minimal admin console pages.
- Run migrations; pass positive and negative tests locally.

Stage 2 — Staging
- Deploy user API & console.
- Seed 1–2 test keys; run end-to-end mint→redeem.
- Exercise negative tests; validate logs, metrics, Sentry.

Stage 3 — Production (soft)
- Release RBAC + endpoints; enable admin console for internal admins.
- Mint a few keys and upgrade trusted users; monitor.

Stage 4 — Production (general)
- Publish runbooks for support; expose pro features in UI (with guards).
- Continue monitoring; adjust rate limits and UX copy as needed.

---

## Risks & Mitigations

- Key leakage — Never store plaintext; display once; optional short expiry; rate-limit redeem.
- AuthZ gaps — Centralize guards; add tests per route; log decisions.
- Session staleness — Rotate on upgrade/downgrade; client refresh flow.
- Admin misuse — Audit key/role/entitlement changes; alert on spikes.
- Metrics visibility — Add counters + simple alerts (redeem failures, 403 rates).

---

## Checklists

Engineering DoD
- Migrations applied; types pass.
- Guards on all premium/admin routes.
- Keys endpoints: mint/redeem/revoke + audits + rate limits.
- Optional: admin entitlements update route.
- Metrics counters + structured logs present.
- Sentry wired (optional).
- Docs: API, Admin Upgrade Runbook, Support Runbook.
- Tests: positive/negative pass in dev and staging.

Operations DoD
- Admin users identified & confirmed.
- Brevo/email from Phase 0 remains configured.
- Runbooks committed to repo; support trained.
- Alert thresholds set (redeem failures, 403 on pro routes).

---

## Notes for This Repo

- Wrapper route marker for future gating added in `user-api/src/index.ts` next to `/u/proxy/ai/pipeline` (comments only; no behavior change in Phase 1 start).
- Keep entitlements as source of truth. In future billing, switch bit-flips from keys → payment webhooks without changing guards.

---

## Phase 2 — Execution Plan (Pro Gating, History, Admin UX)

## Objectives (DoD)
- Enforce pro gating at server boundaries using `requireEntitlement`.
- Ship a "My Jobs" dashboard: list, details, SSE logs, artifacts, verify (explorer URL).
- Improve Admin UX: audit log viewer, bulk key mint, filters/export.
- Observability: Sentry dashboards/alerts; expand metrics and add queries.
- Tests: Expand Playwright E2E (positive/negative).
- Optional: Enterprise auth (SSO, 2FA).

## Scope & Surfaces
- Backend (User API)
  - Apply `requireEntitlement` to premium surfaces before calling upstream:
    - Wallet deploy: `wallet_deployments`.
    - History export: `history_export`.
    - Chat agents: `chat_agents` (and rate-limit sessions/runs).
    - Hosted frontend: `hosted_frontend` routes.
  - Quotas via `entitlements.limits` (e.g., `daily_jobs`).
  - Add audit events for pro-only route access denials.
- Frontend (User Dashboard)
  - Pages: My Jobs, Job Details (logs/artifacts/verify links), Pro upgrade state.
  - Use `/u/jobs`, `/u/jobs/:jobId`, attach on create, and surface upstream verify link.
- Admin Console
  - Audit log viewer with filters (event, user, date).
  - Bulk key mint; CSV export; status filters and search.

## Endpoint Additions/Changes
- Enforce on existing wrappers (e.g., `/u/proxy/ai/pipeline`) with `requireEntitlement('chat_agents')` or feature-specific flags.
- Add endpoints for dashboard convenience if needed (e.g., `/u/jobs/recent`).
- Admin: `/u/admin/audit?user=&event=&from=&to=` (read-only, paginated).

## Metrics & Alerts
- Metrics: counters for pro-only route hits and 403s; job counts per user/day; SSE errors.
- Alerts: 403 spikes on pro routes; redeem failures; login error rates.
- Dashboards: Sentry issues; basic usage charts from `/u/metrics` + logs.

## Test Plan (Phase 2)
- E2E (Playwright):
  - Login (dev OTP) → access admin pages → mint/revoke → entitlements toggle → downgrade.
  - Pro gating: pro user succeeds on gated routes; non-pro gets 403.
  - Job flows: create pipeline via proxy → appears in My Jobs → details page loads logs/artifacts.
- Negative: missing CSRF, non-admin on admin routes, rate-limit exceed.

## Rollout
- Staging: enable `COOKIES_CROSS_SITE=1` and set `COOKIE_DOMAIN` if UI/API are on different sites; set `TRUST_PROXY=1`.
- Seed test users/keys; validate E2E; verify Sentry events.
- Production: gradual exposure of gated features; publish runbooks.

## Risks & Mitigations
- Over-gating legit users → clear errors, support runbook, quick entitlements toggle.
- Log/Artifact fetch fragility → retries and UI fallbacks.
- SSE stability → resume with last index, switch to polling on failure.

---

# Phase 3 — Upstream Wrapper Coverage (EVI_BASE_URL)

## Objectives (DoD)
- Implement server-side wrappers for priority upstream endpoints while preserving auth, CSRF, and RBAC.
- Ensure consistent response passthrough; attach ownership context where applicable.
- Add production-grade SSE proxy for logs, with fallbacks and metrics.
- Document and test end-to-end (curl + Playwright) across all wrappers.

## Scope & Endpoints (User API → Upstream)
- POST /u/proxy/ai/pipeline → POST ${EVI_BASE_URL}/api/ai/pipeline (already implemented)
- GET  /u/proxy/job/:id → GET ${EVI_BASE_URL}/api/job/:id
- GET  /u/proxy/job/:id/status → GET ${EVI_BASE_URL}/api/job/:id/status
- GET  /u/proxy/job/:id/logs → GET ${EVI_BASE_URL}/api/job/:id/logs
- GET  /u/proxy/job/:id/logs/stream → GET ${EVI_BASE_URL}/api/job/:id/logs/stream (SSE)
- GET  /u/proxy/artifacts → GET ${EVI_BASE_URL}/api/artifacts?jobId=...
- GET  /u/proxy/artifacts/sources → GET ${EVI_BASE_URL}/api/artifacts/sources?jobId=...
- GET  /u/proxy/artifacts/abis → GET ${EVI_BASE_URL}/api/artifacts/abis?jobId=...
- GET  /u/proxy/artifacts/scripts → GET ${EVI_BASE_URL}/api/artifacts/scripts?jobId=...
- GET  /u/proxy/artifacts/audit → GET ${EVI_BASE_URL}/api/artifacts/audit?jobId=...
- GET  /u/proxy/artifacts/compliance → GET ${EVI_BASE_URL}/api/artifacts/compliance?jobId=...

Notes from upstream (see evi_main_apis.md):
- Job states: running → completed, progress %, step + stepHistory, timings.
- SSE emits events: hello, log, heartbeat, end; payloads include i (index), t (ts), level, msg.
- Artifacts groups: sources, abis, scripts, audit, compliance; query param jobId required.

## Contract & Behavior
- Auth: require valid session (evium_access). CSRF required for POST routes.
- Entitlements (Phase 2 dependency):
  - Gate pipeline create and potentially heavy endpoints under `wallet_deployments|chat_agents` as appropriate.
  - Enforce per-user quotas via `entitlements.limits` (e.g., daily_jobs) before upstream.
- Rate limits (env-driven):
  - pipeline create: reuse RL_PIPELINE_* limits (implemented).
  - job reads/logs/artifacts: add RL_USER_READS_PER_15M, RL_IP_READS_PER_15M (new envs) with conservative defaults.
- Response: proxy upstream status/body verbatim; add no transformations except minimal normalization.
- Side effects:
  - On pipeline create success with job.id: attach ownership (already implemented) and log audit; increment metrics.
  - Reads: no DB mutation; optional lightweight cache (below).

## Caching Strategy (Phase 3a optional, behind env)
- job detail (/job/:id, /status):
  - Cache last JSON for 30–60s per job (in Redis). Key: job:detail:<id>. TTL: 60s.
  - Invalidate/update on attach or observed state change.
- artifacts endpoints:
  - Cache for 10–30 minutes by jobId + artifact kind. Key: job:artifacts:<kind>:<jobId>.
  - Allow bypass with `Cache-Control: no-cache` from admin clients.

## SSE Proxy (logs/stream)
- Use Node stream piping with proper headers: Content-Type: text/event-stream, Cache-Control: no-cache, Connection: keep-alive.
- Forward events as-is; send heartbeats to keep connection alive if upstream stalls.
- Abort on client disconnect; propagate upstream close; surface `end` event to client.
- Backoff/retry policy on transient network errors (ETIMEDOUT):
  - Retry up to N times with jittered delay (e.g., 250–1000ms) unless client closed.
  - Emit an `event: error` with a short message when retries exceed threshold.

## Error Handling & Timeouts
- Respect upstream status codes; pass through body.
- Apply request timeouts (e.g., 30s for GET, 90s for pipeline create). For SSE, no hard timeout but idle heartbeat every 15–30s.
- Map local failures: 401 unauthorized (no session), 403 forbidden (CSRF/gating), 429 rate_limited, 500 internal_error.

## Observability
- Sentry: add tags route=wrapper, upstream_status, endpoint, jobId (if present). Capture exceptions on upstream failures.
- Metrics: counters per endpoint (wrapperPipelineCreate, wrapperJobGet, wrapperLogsGet, wrapperLogsSSE, wrapperArtifactsGet...), duration histograms, retry counts.
- Logs: structured JSON with method, url, status, duration_ms, upstream_ms, jobId.

## API Docs & Examples
- Update user-api/docs/API.md:
  - New /u/proxy/* endpoints with method, params, auth/CSRF requirements.
  - Curl examples for each; SSE example via curl -N.
- Update TESTING.md:
  - End-to-end flow: create pipeline → poll status → stream logs → fetch artifacts.

## Test Plan
- Unit: input validation, entitlement gating, rate-limit branches, timeout/error mapping.
- Integration (dev):
  - Create pipeline, then GET job, status, logs, logs/stream.
  - Fetch artifacts variants (sources, abis, scripts, audit, compliance).
  - Negative: unauthorized/forbidden, 404 job, RL exceed, upstream 5xx propagation, SSE disconnect/retry.
- E2E (Playwright): user journey in Evi_Ide
  - Start a job → view status page → live logs via SSE → view artifacts tabs → open verify link.

## Rollout
- Stage with realistic rate limits and COOKIES_CROSS_SITE=1 if cross-site; TRUST_PROXY=1 behind proxy.
- Validate curl flows and UI in staging; set alerts on upstream failure rates.
- Gradual production enable; monitor SSE stability and adjust retry/backoff.

## Risks & Mitigations
- Upstream latency/ETIMEDOUT → timeouts + retries + UI polling fallback.
- SSE disconnections → heartbeat, reconnect with last index if supported, fallback to /logs polling.
- Cost/abuse on read endpoints → apply RL and short caches; admin bypass when needed.
