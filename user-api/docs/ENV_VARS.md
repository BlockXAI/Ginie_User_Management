# Environment Variables

This document explains each environment variable used by `user-api`, how to configure it, and its impact on the system.

Paths:
- Source map: `user-api/src/env.ts`
- Example file: `user-api/.env.example`

## Core

- NODE_ENV
  - Values: development | production | staging | test
  - Impact: In development, cookies are not `Secure`; in other modes they are. Also controls config validation strictness.
  - Recommended: development (local), production (prod), staging (pre-prod)

- PORT
  - API server port. Default: 8080.
  - Impact: Exposes HTTP port for the API.

- APP_URL
  - Frontend origin for CORS, e.g. `http://localhost:3000`.
  - Impact: CORS will allow this origin with credentials for cookie flows. Must match the browser app origin exactly.

- DATABASE_URL
  - Postgres connection string, e.g. `postgres://postgres:postgres@localhost:5432/appdb`.
  - Impact: All user/session/entitlement/keys data is stored here.

- REDIS_URL
  - Redis connection URI, e.g. `redis://localhost:6379`.
  - Impact: Used for rate limits and, in some flows, OTP state.

- SESSION_SECRET
  - Long random secret (≥32 chars). Default is a dev-only value.
  - Impact: Reserved for signing/crypto; set a strong unique value in production.

## OTP & Email

- OTP_PROVIDER_MODE
  - Values: dev | prod
  - Impact: dev prints OTP codes to server logs (no emails). prod uses the stateful provider and expects email delivery to be configured.

- BREVO_API_KEY
  - API key for Brevo (Sendinblue) to send OTP emails in `prod` mode.
  - Impact: Required for `prod` OTP; not needed in `dev`.

- EMAIL_FROM_NAME / EMAIL_FROM_ADDRESS / EMAIL_REPLY_TO
  - Email envelope details for OTP emails.
  - Impact: Controls From/Reply-To in OTP emails. Required in `prod`.

- BREVO_TEMPLATE_ID_OTP (optional)
  - Numeric template id in Brevo for OTP email.
  - Impact: If set, use the template for OTP messages; else fallback content.

- TURNSTILE_SECRET_KEY (optional)
  - Cloudflare Turnstile secret key. If set, `/u/auth/send-otp` requires a valid captcha token.
  - Impact: Anti-abuse protection for OTP send.

## Rate limits

- RL_OTP_SEND_PER_15M, RL_OTP_SEND_IP_PER_15M, RL_OTP_VERIFY_PER_15M
  - Numbers per 15 minutes for OTP send/verify by identity and IP.

- RL_PIPELINE_CREATE_PER_15M, RL_PIPELINE_CREATE_IP_PER_15M
  - Numbers per 15 minutes for the wrapper `/u/proxy/ai/pipeline` route (future pro gating).

- RL_KEYS_REDEEM_PER_15M, RL_KEYS_REDEEM_IP_PER_15M
  - Numbers per 15 minutes for key redeem by user and by IP.

- Admin endpoints (env-configurable; generous defaults in development):
  - RL_ADMIN_KEYS_MINT_USER_PER_15M, RL_ADMIN_KEYS_MINT_IP_PER_15M
  - RL_ADMIN_KEYS_REVOKE_USER_PER_15M, RL_ADMIN_KEYS_REVOKE_IP_PER_15M
  - RL_ADMIN_ENTITLEMENTS_USER_PER_15M, RL_ADMIN_ENTITLEMENTS_IP_PER_15M
  - RL_ADMIN_DOWNGRADE_USER_PER_15M, RL_ADMIN_DOWNGRADE_IP_PER_15M
  - RL_ADMIN_LOOKUP_USER_PER_15M, RL_ADMIN_LOOKUP_IP_PER_15M

Impact: All rate limits are enforced via Redis; 429 on exceed.

## Upstream and Observability

- EVI_BASE_URL
  - Base URL for the upstream AI API used by the wrapper route.
  - Impact: `/u/proxy/ai/pipeline` posts to `${EVI_BASE_URL}/api/ai/pipeline`.

- SENTRY_DSN / SENTRY_ENV / SENTRY_TRACING_SAMPLE_RATE
  - Sentry configuration for error/trace reporting.
  - Impact: When `SENTRY_DSN` is set, Sentry is initialized; tracing sample rate controls tracing volume (0–1).

## Networking and Admin Seed

- TRUST_PROXY
  - Set to `1` or `true` when running behind a reverse proxy (NGINX, Railway, Heroku) so Express trusts `X-Forwarded-*`.

- SEED_ADMIN_EMAILS
  - Comma-separated list of emails to auto-promote to admin on startup.
  - Impact: Each email is upserted, entitlements ensured, and role set to `admin` once per boot.

## Cookies & Cross‑site

- COOKIES_CROSS_SITE (optional)
  - Values: `1` | `true` to enable cross-site cookies.
  - Impact: Sets cookies with `SameSite=None; Secure` for cross-site setups (e.g., UI and API on different sites). Requires HTTPS and, in production, a trusted proxy.

- COOKIE_DOMAIN (optional)
  - Example: `.yourdomain.com`
  - Impact: Sets cookie Domain to allow subdomain sharing (ui.yourdomain.com, api.yourdomain.com). Leave unset for localhost/dev.

## Notes

- Validation: `src/env.ts` validates required variables at startup. In production, `DATABASE_URL`, `REDIS_URL`, and a strong `SESSION_SECRET` are required. In `prod` OTP mode, Brevo vars are required.
- Cookies: `NODE_ENV` controls cookie security; `COOKIES_CROSS_SITE` switches to `SameSite=None; Secure` for cross-site deployments. Use HTTPS in production or cookies won't be sent.
- CORS: `APP_URL` must match your frontend origin exactly, including scheme and port.
