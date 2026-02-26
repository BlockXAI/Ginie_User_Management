# EVI User Management Setup Guide

This guide shows how to set up and run the User API on a new machine, with and without Docker; how cookies/CSRF work; CLI vs frontend flows; and common troubleshooting. It also summarizes Phase 1 scope and status.

## Prerequisites

- Node.js 20+
- Docker (optional but recommended for DBs) and Git
- Postgres 14+ and Redis 6+ (via Docker or local install)

## Repository layout

- User API: `user-api/`
  - Source: `user-api/src/`
  - Docs: `user-api/docs/`
  - Env: `user-api/.env`
  - Dockerfile: `user-api/Dockerfile`

## Environment variables (user-api/.env)

Required for local dev:
- `APP_URL` — Frontend origin for CORS (e.g., `http://localhost:3000`)
- `PORT` — API port (default `8080`)
- `DATABASE_URL` — e.g., `postgres://postgres:postgres@localhost:5432/appdb`
- `REDIS_URL` — e.g., `redis://localhost:6379`
- `SESSION_SECRET` — Long random string (≥32 bytes)
- `OTP_PROVIDER_MODE` — `dev` or `prod` (see OTP section)
- Optional email/SaaS: `BREVO_API_KEY`, `EMAIL_FROM_*`
- Optional Sentry: `SENTRY_*`
- Optional proxy: `TRUST_PROXY=1`
- Optional admin bootstrap: `SEED_ADMIN_EMAILS="alice@example.com,bob@example.com"`

## Databases via Docker (recommended)

- Create an isolated network (once):
```bash
docker network create evi-net || true
```

- Option A — Pull from Docker Hub (default):
```bash
docker pull postgres:16
docker pull redis:7
```

- Option B — If pulls hang, use a registry mirror (works offline-first for some networks):
  1) Docker Desktop → Settings → Docker Engine → set:
  ```json
  {
    "registry-mirrors": ["https://mirror.gcr.io"],
    "dns": ["1.1.1.1", "8.8.8.8"],
    "builder": { "gc": { "enabled": true, "defaultKeepStorage": "20GB" } }
  }
  ```
  2) Apply & restart Docker Desktop
  3) Pull mirrored images (example):
  ```bash
  docker pull mirror.gcr.io/library/postgres:16
  docker pull mirror.gcr.io/library/redis:7
  # Optional: retag so compose/scripts using official names work
  docker tag mirror.gcr.io/library/postgres:16 postgres:16
  docker tag mirror.gcr.io/library/redis:7 redis:7
  ```

- Run Postgres:
```bash
docker run -d --name evi-pg --network evi-net \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=appdb \
  -p 5432:5432 postgres:16
```

- Run Redis:
```bash
docker run -d --name evi-redis --network evi-net -p 6379:6379 redis:7
```

- Verify containers:
```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker logs --tail=50 evi-pg
docker logs --tail=50 evi-redis
```

- Configure `.env` (local):
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/appdb
REDIS_URL=redis://localhost:6379
```

Tip: If you run the API in Docker on `evi-net`, set `DATABASE_URL=postgres://postgres:postgres@evi-pg:5432/appdb` and `REDIS_URL=redis://evi-redis:6379`.

If image pulls stall, confirm registry reachability: `curl -sf https://registry-1.docker.io/v2/` should 401 quickly (expected). If not, check VPN/proxy/firewall.

## Cloud databases on Railway (CLI)

Provision Postgres + Redis in Railway via CLI and wire to your `.env`.

1) Install CLI and login
```bash
npm i -g @railway/cli   # or: brew install railway
railway login
```

2) Create project (or link to an existing one)
```bash
mkdir -p infra && cd infra
railway init    # choose a name, or run in an existing repo folder and `railway link`
```

3) Add Postgres and Redis plugins
```bash
railway add     # select Postgres
railway add     # select Redis
```

4) View connection variables
```bash
railway variables -j | jq .
# Look for keys like: POSTGRES_URL / DATABASE_URL, and REDIS_URL / UPSTASH_REDIS_REST_URL
```

5) Configure your API `.env`
```bash
# Example (replace with your actual values from step 4)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
REDIS_URL=redis://default:PASSWORD@HOST:PORT
TRUST_PROXY=1
APP_URL=https://your-frontend.example.com
```

Notes
- Railway Postgres exposes a standard `postgres://` or `postgresql://` DSN.
- Railway Redis is often provisioned via Upstash; prefer the `redis://` DSN for this API.
- When deploying the API on Railway, set these variables in the service’s Variables tab as well.
- After updating `.env`, restart the API; health check: `curl -s $BASE_URL/u/healthz | jq` should show `{ ok: true, redis: true }`.

## Local development (no Docker for the API)

```bash
cd user-api
npm ci
npm run dev    # hot reload on :8080
# or
npm run build && npm start
```

Initialize schema (idempotent) and Redis check:
```bash
curl -s http://localhost:8080/u/healthz | jq
# { "ok": true, "redis": true }
```

Seed initial admins (optional):
- Set `SEED_ADMIN_EMAILS` in `.env` (comma-separated). On server start, each email is upserted and promoted to `admin`.

## Building and running the API with Docker

Build image:
```bash
cd user-api
docker build -t evi-user-api:latest .
```
Run container (attach to the same network, pass envs):
```bash
docker run -d --name evi-user-api --network evi-net -p 8080:8080 \
  -e NODE_ENV=development \
  -e APP_URL=http://localhost:3000 \
  -e PORT=8080 \
  -e DATABASE_URL=postgres://postgres:postgres@evi-pg:5432/appdb \
  -e REDIS_URL=redis://evi-redis:6379 \
  -e SESSION_SECRET="dev-only-change-me" \
  -e OTP_PROVIDER_MODE=dev \
  -e SEED_ADMIN_EMAILS="admin@example.com" \
  evi-user-api:latest
```
Health check:
```bash
curl -s http://localhost:8080/u/healthz | jq
```

## OTP provider modes

- `OTP_PROVIDER_MODE=dev` (local):
  - Codes are stored per identity in Redis and logged to the server console.
  - `challengeId` not required for verify (but allowed).
- `OTP_PROVIDER_MODE=prod` (stateful):
  - `POST /u/auth/send-otp` returns `challengeId`.
  - `POST /u/auth/verify` MUST include the same `challengeId`.
  - Email delivery via Brevo (configure `BREVO_API_KEY` and from/reply-to fields).

## Cookies and CSRF model

- HttpOnly cookies set by the API on login/refresh/redeem:
  - `evium_access` (Access token; TTL ~90 minutes)
  - `evium_refresh` (Refresh token; TTL ~30 days)
- Non-HttpOnly cookie:
  - `evium_csrf` (the CSRF token value). For write routes, send header `x-csrf-token: <evium_csrf>`.
- Rotation events (cookies change):
  - On login (/u/auth/verify)
  - On refresh (/u/auth/refresh)
  - On key redeem (/u/keys/redeem)
  - On logout (/u/auth/logout) clears cookies

CLI tip (curl): For any route that sets cookies, use both `-b` and `-c` to persist rotations, then re-read CSRF from the jar:
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
# write call (rotate cookies)
curl -s -b /tmp/evium.jar -c /tmp/evium.jar -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{ ... }' http://localhost:8080/...
# refresh CSRF after
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
```

## CLI quickstart (admin + user)

- Admin login (stateful OTP; include `challengeId`):
```bash
ADMIN_JAR=/tmp/evium_admin.jar; rm -f "$ADMIN_JAR"
SEND=$(curl -s -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d '{"identity":"admin@example.com","name":"Admin"}' \
  http://localhost:8080/u/auth/send-otp)
CH_ID=$(echo "$SEND" | jq -r '.challengeId')
read "ADMIN_OTP?Enter OTP: "
curl -s -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"admin@example.com\",\"otp\":\"$ADMIN_OTP\",\"challengeId\":\"$CH_ID\"}" \
  http://localhost:8080/u/auth/verify | jq .
```
- Mint key (admin):
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$ADMIN_JAR" | tail -n1)
MINT=$(curl -s -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-01-31T12:00:00Z"}' \
  http://localhost:8080/u/admin/keys/mint); echo "$MINT" | jq .
KEY=$(echo "$MINT" | jq -r '.key'); KEY_ID=$(echo "$MINT" | jq -r '.id')
```
- User login and redeem:
```bash
USER_JAR=/tmp/evium_user.jar; rm -f "$USER_JAR"
SEND_U=$(curl -s -c "$USER_JAR" -H 'Content-Type: application/json' \
  -d '{"identity":"user@example.com","name":"User"}' \
  http://localhost:8080/u/auth/send-otp)
CH_U=$(echo "$SEND_U" | jq -r '.challengeId')
read "USER_OTP?Enter OTP: "
curl -s -b "$USER_JAR" -c "$USER_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"user@example.com\",\"otp\":\"$USER_OTP\",\"challengeId\":\"$CH_U\"}" \
  http://localhost:8080/u/auth/verify | jq .
USER_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$USER_JAR" | tail -n1)
# Redeem (persist rotated cookies with -c)
curl -s -b "$USER_JAR" -c "$USER_JAR" -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$KEY\"}" \
  http://localhost:8080/u/keys/redeem | jq .
# CSRF rotated; refresh it
USER_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$USER_JAR" | tail -n1)
```

## Frontend integration (Phase 0)

- CORS: The API uses `cors({ origin: env.APP_URL, credentials: true })`. Set `APP_URL` to your frontend origin.
- Credentials: Enable `credentials: 'include'` on fetch/axios; browser will send/receive cookies.
- Login flow:
  1) `POST /u/auth/send-otp` → returns `challengeId` (stateful mode)
  2) `POST /u/auth/verify` with `{ identity, otp, challengeId }` → sets cookies
  3) `GET /u/user/me` to hydrate user
- CSRF: For any write route, read `evium_csrf` cookie and send header `x-csrf-token`.
- Refresh strategy:
  - On 401 responses, call `POST /u/auth/refresh` (with cookies) to rotate tokens, then retry the original request.
  - Optionally preemptively refresh near the access TTL (e.g., every 60 minutes) to reduce 401s.
- Upgrade/downgrade:
  - `POST /u/keys/redeem` and admin downgrade rotate session tokens. Browser captures this automatically; no need to OTP again.
- Security: In production (HTTPS), cookies are `Secure`.

## Admin operations

- User lookup (admin): `GET /u/admin/user/lookup?email=...` or `?id=...`
- Keys:
  - Mint: `POST /u/admin/keys/mint`
  - List: `GET /u/admin/keys?status=&limit=` (status: minted|redeemed|revoked)
  - Get by id: `GET /u/admin/keys/:id`
  - Revoke: `POST /u/admin/keys/revoke` (revokes only minted/unused keys)
- Downgrade user: `POST /u/admin/users/downgrade` with `{ email }` or `{ id }`
- Metrics: `GET /u/metrics` (public) now also returns user counts `{ total, normal, pro, admin }`

## Troubleshooting

- Unauthorized (401) after a write:
  - Cause: Cookies rotated and your client didn’t persist/send updated cookies.
  - CLI: Use `-b` and `-c` together; refresh `evium_csrf` from the jar.
  - Frontend: Call `/u/auth/refresh` then retry.
- `invalid_otp` in stateful mode:
  - Ensure you pass the original `challengeId` to `/u/auth/verify`.
- Missing CSRF (403):
  - Include header `x-csrf-token: <evium_csrf cookie>` on write routes.
- Key revoked vs redeemed:
  - Revoking only affects minted keys. If a key is already redeemed, revoking it later does not downgrade the user. Use admin downgrade.
- HTTP vs HTTPS:
  - In production, cookies are `Secure`. Use HTTPS or set `NODE_ENV=development` for local HTTP.

## Production notes

- Sentry: Set `SENTRY_DSN`, `SENTRY_ENV`, `SENTRY_SAMPLE_RATE`.
- CAPTCHA: If `TURNSTILE_SECRET_KEY` is set, `/u/auth/send-otp` requires a Turnstile token.
- Proxy: If behind a reverse proxy (e.g., NGINX), set `TRUST_PROXY=1`.

## Data model references (Phase 0)

- `users`: `id`, `email`, `role`, `display_name`, `wallet_address`, `metadata` (includes `profile` object)
- `sessions`: access & refresh hashes, expiry, ip, device info, revoked_at
- `entitlements`: per-user flags and `limits`
- `premium_keys`: minted/redeemed/revoked, issued_by, redeemed_by, expires_at

## What to expect in the UI

- Jobs endpoints (`/u/jobs*`) are per-user and require authentication; they return only the authenticated user’s data.
- Metrics endpoint is public and global.
- Access token TTL ~90 minutes; refresh token TTL ~30 days. OTP required only for login (or if refresh cookie is expired/revoked or after logout).

---

# Phase 1 — What’s done and what’s next

Based on `PHASE_1_EXECUTION.md` and the current codebase.

## Completed

- **RBAC middleware**: `requireAuth`, `requireRole` in `user-api/src/authz.ts` (used across admin/user routes).
- **Premium Keys**: `POST /u/admin/keys/mint`, `POST /u/keys/redeem`, `POST /u/admin/keys/revoke`, `GET /u/admin/keys`, `GET /u/admin/keys/:id`.
- **Admin lookup**: `GET /u/admin/user/lookup`.
- **Admin bootstrap**: `SEED_ADMIN_EMAILS` env seeds admins on startup.
- **Profile**: `POST /u/user/profile` (display_name, wallet_address, metadata.profile).
- **Metrics**: Counters + user counts in `GET /u/metrics`.
- **Docs**: `user-api/docs/API.md` (endpoints), this setup guide.

## Pending / Next up in Phase 1

- **Runbooks**: Add `Admin_Upgrade_Runbook.md` and `Support_Runbook.md` with step-by-step flows.
- **Optional admin entitlements update**: Endpoint to directly toggle individual entitlement flags.
- **Pro gating enforcement**: Keep wrapper comments for now; actual entitlement checks on specific pro routes are deferred (per scope).
- **Minimal Admin Console UI**: Basic pages to mint/list/revoke keys and user lookup.
- **Tests**: Flesh out smoke and negative tests as per the plan.
- **Sentry & Alerts**: Finalize DSN and simple alerting thresholds.

---

# Glossary

- **Access token**: Short-lived session cookie (`evium_access`).
- **Refresh token**: Long-lived cookie (`evium_refresh`) used to rotate/refresh access.
- **CSRF token**: Non-HttpOnly cookie (`evium_csrf`) mirrored as header `x-csrf-token` on writes.
- **Opaque key**: One-time premium key shown once to admin; hashed at rest.
- **Entitlements**: Feature flags per user stored in `entitlements`.
