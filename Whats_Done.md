
Repo paths:
- API: `Evi_User_Management/user-api/`
- Admin UI: `Evi_User_Management/admin-console/`

## Phase 0 — Foundations (delivered earlier)

- **[Database & Stores]**
  - Postgres schemas for users/sessions/entitlements/premium_keys.
- **[Auth (OTP)]**
  - `POST /u/auth/send-otp` and `POST /u/auth/verify`.
  - Dev provider (Redis + logs) and Stateful provider (Brevo email) with `challengeId`.
- **[Sessions & CSRF]**
  - HttpOnly cookies: `evium_access`, `evium_refresh`.
  - CSRF cookie: `evium_csrf`; header `x-csrf-token` required on writes.
  - `POST /u/auth/refresh` (rotate) and `POST /u/auth/logout` (clear).
- **[User]**
  - `GET /u/user/me` returns current authenticated user + entitlements.
- **[Routing & CORS]**
  - All routes under `/u/*` prefix.
  - CORS allows `env.APP_URL` origin with credentials.
- **[Rate limits]**
  - OTP send/verify limits via Redis.
- **[Health]**
  - `GET /u/healthz` for readiness (also initializes schema on first hit).

## Phase 1 — Features delivered (this phase)

- **[RBAC & Admin routes]**
  - Middleware: `requireAuth`, `requireRole` in `user-api/src/authz.ts`.
  - `GET /u/admin/user/lookup` — lookup by `email` or `id`.
  - `GET /u/admin/users/active?limit=` — list active users with `last_seen_at`.
  - `POST /u/admin/users/entitlements` — toggle `pro_enabled`, `wallet_deployments`, etc.
  - `POST /u/admin/users/downgrade` — revert a user to `normal`.
- **[Premium Keys lifecycle]**
  - `POST /u/admin/keys/mint` — mint one-time key (optional `expiresAt`).
  - `GET /u/admin/keys` — list keys with filters; `GET /u/admin/keys/:id`.
  - `POST /u/admin/keys/revoke` — revoke minted/unused keys.
  - `POST /u/keys/redeem` — upgrade user to `pro` (rotates cookies).
- **[Profile endpoint modernization]**
  - `POST /u/user/profile` requires: `display_name`, `profile.organization`, `profile.role`.
  - Optional: `wallet_address`, and `profile.location`, `avatar_url`, `bio`, `phone`.
  - Renamed `company` → `organization`; reflected in `/u/user/me` and admin lookup.
- **[Metrics]**
  - `GET /u/metrics` includes counters and user counts by role `{ total, normal, pro, admin }`.
- **[Environment & validation]**
  - Strong env validation in `user-api/src/env.ts` (prod requires DB/Redis/secret; warns in dev).
  - Railway fallbacks: uses `DATABASE_PUBLIC_URL`, `REDIS_PUBLIC_URL` if primary vars unset.
  - Turnstile support: `TURNSTILE_SECRET_KEY` gate on `/u/auth/send-otp` (optional).
  - Sentry envs: `SENTRY_DSN`, `SENTRY_ENV`, `SENTRY_SAMPLE_RATE`; dev-only `/u/dev/sentry-test` to validate capture.
  - Cookies & cross-site: `COOKIES_CROSS_SITE` (enables SameSite=None; Secure), optional `COOKIE_DOMAIN` for subdomains; `TRUST_PROXY` behind proxies.
  - Admin seed: `SEED_ADMIN_EMAILS` auto-promotes emails to admin on startup.
- **[Docs & setup]**
  - `user-api/docs/ENV_VARS.md` — complete env reference and impact.
  - `user-api/docs/SETUP.md` — Docker (with registry mirror), Railway CLI provisioning for Postgres/Redis.
  - Runbooks: `user-api/docs/Admin_Upgrade_Runbook.md`, `user-api/docs/Support_Runbook.md`.
  - `.env.example` created for the API.
- **[Testing]**
  - Scripts: `scripts/phase1_smoke.sh` (happy path) and `scripts/phase1_negative.sh` (failure cases).
  - NPM scripts: `test:phase1:smoke`, `test:phase1:negative`.
  - Playwright E2E scaffold in Admin Console (`tests/login.spec.ts`, `playwright.config.ts`).
- **[Admin Console UI (new)]** `Evi_User_Management/admin-console/`
  - Tech: Next.js (App Router) + Tailwind; docs in `admin-console/README.md`.
  - Login page: OTP send/verify; requires Email + Name.
  - Protected admin layout: checks `/u/user/me` for `role=admin`.
  - Users Lookup: search by email/id; toggle entitlements; downgrade.
  - Active Users: list with `limit` and refresh.
  - Keys: mint (copy-to-clipboard; key shown once), list, revoke.
  - API helper `lib/api.ts`: sends credentials, CSRF header, auto-refreshes on 401.
- **[Dev helpers]**
  - `/u/dev/otp` (OTP provider dev mode) and `/u/dev/sentry-test` (Sentry validation) available in non-production.

## Deferred (not in Phase 1 scope)

- **[Pro gating enforcement]**
  - Wrapper route `/u/proxy/ai/pipeline` remains commented for future entitlement gating.

## File references (key changes)

- **[API]**
  - `user-api/src/index.ts` — routes (admin, user, keys, metrics).
  - `user-api/src/env.ts` — env loading + validation.
  - `user-api/src/otp.ts` — OTP providers (dev/stateful).
- **[Docs]**
  - `user-api/docs/ENV_VARS.md`, `user-api/docs/SETUP.md`.
  - `user-api/docs/Admin_Upgrade_Runbook.md`, `user-api/docs/Support_Runbook.md`.
- **[Tests]**
  - `user-api/scripts/phase1_smoke.sh`, `user-api/scripts/phase1_negative.sh`.
- **[Admin UI]**
  - `admin-console/app/...` (login, admin dashboard, users, keys pages).
  - `admin-console/lib/api.ts`, `admin-console/components/*`.

## Conversion to PDF

- Use your preferred tool (e.g., VS Code Markdown PDF, `pandoc`, or print to PDF) on this file.
  - Example with pandoc:
  ```bash
  pandoc -s FEATURES_SINCE_PHASE_0.md -o FEATURES_SINCE_PHASE_0.pdf
  ```

## Phase 2 — Plan (next)

- **[Pro gating enforcement]** Apply `requireEntitlement` on premium surfaces (deploy, history export, chat agents, hosted frontend). Add optional quotas via `entitlements.limits`.
- **[User dashboard]** "My Jobs" with state, progress, SSE logs, artifacts, verify (explorer URL), and retrieval links.
- **[Admin UX]** Audit log viewer, bulk key minting, richer filters/search, CSV export.
- **[Observability]** Sentry dashboards and alerts (403 spikes, redeem errors); expand `/u/metrics`.
- **[E2E tests]** Expand Playwright coverage for admin operations and user flows; add negative-path tests.
- **[Enterprise auth (optional)]** SSO providers and stronger second factor.
