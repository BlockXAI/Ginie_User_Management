# EVI User API — Phase 1 Endpoints

Base URL: http://localhost:8080
Prefix: All routes are under /u/*
- Cookies: HttpOnly `evium_access`, `evium_refresh`
- CSRF: Non-HttpOnly `evium_csrf` cookie. For write routes, send header `x-csrf-token: <value of evium_csrf>`
- Rate limits: OTP send/verify are limited via Redis (429 on exceed)
- CORS: Backend allows origin `APP_URL` with credentials; ensure it matches your Admin Console origin.
- Cookies: For cross-site deployments, set `COOKIES_CROSS_SITE=1` (SameSite=None; Secure) and optionally `COOKIE_DOMAIN`.

## Variables

```bash
export USER_API="http://localhost:8080"
export JAR="/tmp/evium.jar"
export CSRF=$(awk '$6=="evium_csrf" {print $7}' "$JAR" | tail -n1)
export BASE_URL="https://evi-wallet-production.up.railway.app"
```

## Health

- GET /u/healthz

Curl
```bash
curl -s http://localhost:8080/u/healthz | jq
```

Response
```json
{ "ok": true, "redis": true }
```

## Admin — Users (active sessions)

- GET /u/admin/users/active?limit=

Notes
- Requires admin authentication.
- Returns users with currently valid, non-revoked sessions; ordered by last seen.

Curl
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/admin/users/active?limit=100" | jq
```

Response
```json
{
  "ok": true,
  "users": [
    { "id": "<uuid>", "email": "user@example.com", "role": "pro", "display_name": "Arpit", "last_seen_at": "2025-10-24T06:05:00.000Z" }
  ]
}
```

## Admin — Update user entitlements (direct)

- POST /u/admin/users/entitlements

Notes
- Requires admin authentication and CSRF.
- Provide exactly one of `id` or `email` and any entitlement flags to set.

Curl
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/admin/users/entitlements \
  -H "x-csrf-token: ${ADMIN_CSRF}" -H 'Content-Type: application/json' \
  -d '{ "email": "user@example.com", "pro_enabled": true, "wallet_deployments": true, "limits": { "daily_jobs": 25 } }' | jq
```

Response
```json
{
  "ok": true,
  "user": { "id": "<uuid>", "email": "user@example.com", "role": "pro", "display_name": "Arpit" },
  "entitlements": { "pro_enabled": true, "wallet_deployments": true, "history_export": false, "chat_agents": false, "hosted_frontend": false, "limits": { "daily_jobs": 25 } }
}
```

## Admin — User lookup (requires admin)

- GET /u/admin/user/lookup?email=... or ?id=...
- Returns user details and entitlements. Requires requester to have role `admin`.

Curl
```bash
# by email
curl -s -b /tmp/evium.jar "http://localhost:8080/u/admin/user/lookup?email=demo@example.com" | jq

# by id
curl -s -b /tmp/evium.jar "http://localhost:8080/u/admin/user/lookup?id=<uuid>" | jq
```

Response
```json
{
  "ok": true,
  "user": {
    "id": "<uuid>",
    "email": "demo@example.com",
    "role": "normal",
    "display_name": null,
    "wallet_address": null,
    "profile": { "organization": "", "role": "", "location": "", "avatar_url": "", "bio": "", "phone": "" }
  },
  "entitlements": { "pro_enabled": false, "wallet_deployments": false, "history_export": false, "chat_agents": false, "hosted_frontend": false, "limits": {} }
}
```

## Metrics (basic, in-memory)

- GET /u/metrics

Curl
```bash
curl -s http://localhost:8080/u/metrics | jq
```

Response
```json
{
  "ok": true,
  "metrics": { "otpSend": 1, "otpVerify": 1, "login": 1, "logout": 0, "jobsAttach": 2, "keysMint": 0, "keysRedeem": 0, "keysRevoke": 0, "roleUpgrade": 0, "roleDowngrade": 0, "entitlementsUpdate": 0 },
  "users": { "total": 1, "normal": 1, "pro": 0, "admin": 0 }
}
```

## Auth — Send OTP

- POST /u/auth/send-otp
- Body: { identity: string(email), name: string, captchaToken?: string, mode?: 'auto'|'signin'|'signup' }
- CAPTCHA: When `TURNSTILE_SECRET_KEY` is set on the server, `captchaToken` is REQUIRED and must be a valid Cloudflare Turnstile token.
- Returns `challengeId` (required later for verification in stateful mode)
- Modes:
  - auto (default): no existence check here; proceed to verify
  - signin: if user does not exist → 404 user_not_found
  - signup: if user already exists → 409 user_already_exists

Curl — auto (default)
```bash
curl -s -X POST http://localhost:8080/u/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "demo@example.com", "name": "Demo User" }' | jq
```

Curl — signin (expect 404 if not exists)
```bash
curl -s -i -X POST http://localhost:8080/u/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "noaccount@example.com", "name": "No Account", "mode": "signin" }'
```

Curl — signup (expect 409 if already exists)
```bash
curl -s -i -X POST http://localhost:8080/u/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "existing@example.com", "name": "Existing", "mode": "signup" }'
```

Curl — with CAPTCHA (TURNSTILE enabled)
```bash
curl -s -X POST http://localhost:8080/u/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "demo@example.com", "name": "Demo User", "captchaToken": "<turnstile-response-token>", "mode": "auto" }' | jq
```

Response
```json
{ "ok": true, "challengeId": "Hdi_fF6L...", "expiresAt": 1761212093562 }
```

## Auth — Verify OTP (login)

- POST /u/auth/verify
- Body: { identity: string(email), otp: string, challengeId?: string, mode?: 'auto'|'signin'|'signup', name?: string }
- On success sets cookies: `evium_access`, `evium_refresh`, and `evium_csrf`
- Modes:
  - auto (default): if user doesn’t exist, create it; otherwise sign in
  - signin: if user does not exist → 404 user_not_found
  - signup: if user already exists → 409 user_already_exists

Curl — auto (default)
```bash
curl -s -c /tmp/evium.jar -X POST http://localhost:8080/u/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "demo@example.com", "otp": "123456", "challengeId": "Hdi_fF6L..." }' | jq
```

Curl — signin
```bash
curl -s -c /tmp/evium.jar -X POST http://localhost:8080/u/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "existing@example.com", "otp": "123456", "challengeId": "Hdi_fF6L...", "mode": "signin" }' | jq
```

Curl — signup (create user if not exists; send name to set display_name)
```bash
curl -s -c /tmp/evium.jar -X POST http://localhost:8080/u/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "newuser@example.com", "otp": "123456", "challengeId": "Hdi_fF6L...", "mode": "signup", "name": "New User" }' | jq
```

Curl — invalid OTP (expect 401)
```bash
curl -s -i -X POST http://localhost:8080/u/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{ "identity": "demo@example.com", "otp": "000000", "challengeId": "Hdi_fF6L..." }'
```

Response
```json
{
  "ok": true,
  "user": { "id": "<uuid>", "email": "demo@example.com", "role": "normal", "display_name": null },
  "entitlements": { "pro_enabled": false, "wallet_deployments": false, "history_export": false, "chat_agents": false, "hosted_frontend": false, "limits": {} }
}
```

## Auth — Logout

- POST /u/auth/logout

Curl
```bash
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/auth/logout | jq
```

Response
```json
{ "ok": true }
```

## Auth — Refresh (rotate access/refresh)

- POST /u/auth/refresh
- Uses `evium_refresh` cookie to issue new `evium_access`, `evium_refresh`, and `evium_csrf`.
- No CSRF required. With curl, use both `-b` and `-c` to update your jar.

Curl
```bash
curl -s -b /tmp/evium.jar -c /tmp/evium.jar -X POST http://localhost:8080/u/auth/refresh | jq
```

Response
```json
{ "ok": true }
```

## Me

- GET /u/user/me

Curl
```bash
curl -s -b /tmp/evium.jar http://localhost:8080/u/user/me | jq
```

Response
```json
{
  "ok": true,
  "user": {
    "id": "<uuid>",
    "email": "demo@example.com",
    "role": "normal",
    "display_name": null,
    "wallet_address": null,
    "profile": {
      "organization": "Sgsits",
      "role": "engineer",
      "location": "indore",
      "country": "India",
      "state": "MP",
      "city": "indore",
      "avatar_url": "/u/user/avatar/<avatar-id>",
      "bio": "Tell others about yourself",
      "phone": "+91-...",
      "birthday": "Not set",
      "gender": "Not set",
      "social": { "github": null, "linkedin": null, "twitter": null, "telegram": null }
    }
  },
  "entitlements": { ... },
  "counts": { "jobs_today": 0, "jobs_total": 0 }
}
```

## Jobs — Attach ownership (write)

- POST /u/jobs/attach
- Headers: x-csrf-token: <evium_csrf>
- Body: { jobId: string, type?: string, prompt?: string, filename?: string, network: string }

Curl
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/jobs/attach \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{ "jobId": "ai_pipeline_123", "type": "pipeline", "prompt": "Create ERC20", "filename": "Token.sol", "network": "basecamp" }' | jq
```

Response
```json
{
  "ok": true,
  "job": {
    "job_id": "ai_pipeline_123",
    "user_id": "<uuid>",
    "type": "pipeline",
    "prompt": "Create ERC20",
    "filename": "Token.sol",
    "network": "basecamp",
    "created_at": "2025-10-23T03:59:11.438Z"
  }
}
```

## Proxy — Audit/Compliance Reports (GET + POST, JSON or Markdown)

- GET /u/proxy/artifacts/audit?jobId=
- GET /u/proxy/artifacts/compliance?jobId=
- POST /u/proxy/audit/byJob
- POST /u/proxy/compliance/byJob

Notes
- GET routes require authentication; POST routes require authentication + CSRF (`x-csrf-token`).
- Content negotiation:
  - Default output is JSON.
  - To force Markdown: add `?format=md` (or `?fmt=md`) OR send header `Accept: text/markdown`.
  - To force JSON explicitly: `?format=json`.

### GET — Audit (JSON)
```bash
curl -s -b /tmp/evium.jar \
  "http://localhost:8080/u/proxy/artifacts/audit?jobId=$JOB_ID" | jq
```

### GET — Audit (Markdown)
```bash
curl -s -i -b /tmp/evium.jar -H 'Accept: text/markdown' \
  "http://localhost:8080/u/proxy/artifacts/audit?jobId=$JOB_ID&format=md"
```

### GET — Compliance (JSON)
```bash
curl -s -b /tmp/evium.jar \
  "http://localhost:8080/u/proxy/artifacts/compliance?jobId=$JOB_ID" | jq
```

### GET — Compliance (Markdown)
```bash
curl -s -i -b /tmp/evium.jar -H 'Accept: text/markdown' \
  "http://localhost:8080/u/proxy/artifacts/compliance?jobId=$JOB_ID&format=md"
```

### POST — Generate Audit by Job (JSON)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
printf '{"jobId":"%s","model":"gemini-2.0-flash","policy":{}}' "$JOB_ID" | \
  curl -s -b /tmp/evium.jar \
    -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' \
    --data-binary @- "http://localhost:8080/u/proxy/audit/byJob" | jq
```

### POST — Generate Audit by Job (Markdown)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
printf '{"jobId":"%s","model":"gemini-2.0-flash","policy":{}}' "$JOB_ID" | \
  curl -s -i -b /tmp/evium.jar \
    -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' -H 'Accept: text/markdown' \
    --data-binary @- "http://localhost:8080/u/proxy/audit/byJob?format=md"
```

### POST — Generate Compliance by Job (JSON)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
printf '{"jobId":"%s","model":"gemini-2.0-flash","policy":{}}' "$JOB_ID" | \
  curl -s -b /tmp/evium.jar \
    -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' \
    --data-binary @- "http://localhost:8080/u/proxy/compliance/byJob" | jq
```

### POST — Generate Compliance by Job (Markdown)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
printf '{"jobId":"%s","model":"gemini-2.0-flash","policy":{}}' "$JOB_ID" | \
  curl -s -i -b /tmp/evium.jar \
    -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' -H 'Accept: text/markdown' \
    --data-binary @- "http://localhost:8080/u/proxy/compliance/byJob?format=md"
```

Tips
- Do not pipe Markdown output to `jq`. Only use `jq` with JSON responses.
- If you prefer single-line JSON body without printf:
  ```bash
  curl -s -b /tmp/evium.jar -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' \
    -d "{\"jobId\":\"$JOB_ID\",\"model\":\"gemini-2.0-flash\",\"policy\":{}}" \
    "http://localhost:8080/u/proxy/audit/byJob" | jq
  ```

## Premium Keys — Admin (mint/list/get/revoke)

- POST /u/admin/keys/mint
- GET /u/admin/keys?status=&limit=
- GET /u/admin/keys/:id
- POST /u/admin/keys/revoke

Notes
- Requires admin authentication and CSRF for POST routes.
- The mint response returns the opaque key exactly once. Store it securely.
- Revoking affects only keys that are still minted (unused). Revoking a key AFTER it has been redeemed does not automatically downgrade the user. Use the Admin Downgrade endpoint for that.

Mint
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/admin/keys/mint \
  -H "x-csrf-token: ${ADMIN_CSRF}" -H 'Content-Type: application/json' \
  -d '{ "expiresAt": "2026-01-31T12:00:00Z" }' | jq
```

List
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/admin/keys?status=minted&limit=20" | jq
```

Get by id
```bash
curl -s -b /tmp/evium.jar http://localhost:8080/u/admin/keys/<uuid> | jq
```

Revoke
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/admin/keys/revoke \
  -H "x-csrf-token: ${ADMIN_CSRF}" -H 'Content-Type: application/json' \
  -d '{ "id": "<uuid>" }' | jq
```

## Premium Keys — User (redeem)

- POST /u/keys/redeem

Notes
- Requires authentication and CSRF.
- On success, access/refresh cookies and CSRF rotate. With curl, use both `-b` and `-c` and then refresh CSRF from cookie jar.

Redeem
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -c /tmp/evium.jar -X POST http://localhost:8080/u/keys/redeem \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{ "key": "<opaque-key>" }' | jq

# Refresh CSRF after redeem (cookies rotated)
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
```

Response
```json
{
  "ok": true,
  "user": { "id": "<uuid>", "email": "demo@example.com", "role": "pro", "display_name": null },
  "entitlements": { "pro_enabled": true, "wallet_deployments": false, "history_export": false, "chat_agents": false, "hosted_frontend": false, "limits": {} }
}
```

## Admin — Downgrade user

- POST /u/admin/users/downgrade

Notes
- Requires admin authentication and CSRF.
- Body may provide exactly one of `email` or `id`.

Curl
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/admin/users/downgrade \
  -H "x-csrf-token: ${ADMIN_CSRF}" -H 'Content-Type: application/json' \
  -d '{ "email": "user@example.com" }' | jq
```

Response
```json
{
  "ok": true,
  "user": { "id": "<uuid>", "email": "user@example.com", "role": "normal", "display_name": null },
  "entitlements": { "pro_enabled": false, "wallet_deployments": false, "history_export": false, "chat_agents": false, "hosted_frontend": false, "limits": {} }
}
```

## User — Update profile (profile)

- POST /u/user/profile

Notes
- Requires authentication and CSRF.
- Body requires `display_name`, and `profile.organization`, `profile.role`.
- Profile fields supported:
  - `location?: string`
  - `country?: string`
  - `state?: string`
  - `city?: string`
  - `avatar_url?: string(url)`
  - `bio?: string`
  - `phone?: string`
  - `birthday?: string`
  - `gender?: string`
  - `social?: { github?: string, linkedin?: string, twitter?: string, telegram?: string }`

Curl
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/user/profile \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{
    "display_name": "Arpit Singh",
    "wallet_address": null,
    "profile": {
      "organization": "Sgsits",
      "role": "engineer",
      "country": "India",
      "state": "MP",
      "city": "indore",
      "bio": "Hello!",
      "social": { "github": "https://github.com/your", "linkedin": "https://linkedin.com/in/your" }
    }
  }' | jq
```

Response
```json
{
  "ok": true,
  "user": {
    "id": "<uuid>",
    "email": "user@example.com",
    "role": "pro",
    "display_name": "Arpit Singh",
    "wallet_address": null,
    "profile": {
      "organization": "Sgsits",
      "role": "engineer",
      "country": "India",
      "state": "MP",
      "city": "indore",
      "bio": "Hello!"
    }
  },
  "entitlements": { "pro_enabled": true, "wallet_deployments": false, "history_export": false, "chat_agents": false, "hosted_frontend": false, "limits": {} }
}
```

## User — Avatar upload/update, serve, delete, prune

- POST /u/user/avatar
- GET /u/user/avatar/:id
- DELETE /u/user/avatar/:id
- POST /u/user/avatar/prune

Notes
- Requires authentication.
- Write routes require CSRF header `x-csrf-token`.
- Upload accepts binary body with Content-Type one of: `image/png`, `image/jpeg`, `image/webp`.
- Max size: 6 MB. On upload, `profile.avatar_url` is set to the new URL. Re-uploading updates the avatar by creating a new record and updating `avatar_url`.
- Images are stored in Railway Postgres (`BYTEA`) and served via `/u/user/avatar/:id` with appropriate Content-Type and caching.

Upload (PNG)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -H "x-csrf-token: ${CSRF}" -H 'Content-Type: image/png' \
  --data-binary @./avatar.png http://localhost:8080/u/user/avatar | jq
# => { "ok": true, "avatar": { "id": "<uuid>", "url": "/u/user/avatar/<uuid>" } }
```

Serve
```bash
curl -s -i http://localhost:8080/u/user/avatar/<uuid>
```

Delete (only your own avatar)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X DELETE \
  -H "x-csrf-token: ${CSRF}" http://localhost:8080/u/user/avatar/<uuid> | jq
# If the deleted id matches current profile.avatar_url, it will be unset.
```

Prune older avatars (keep last N, default 3)
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/user/avatar/prune \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{ "keepLatest": 3 }' | jq
```

## Proxy — Create AI pipeline job (with ownership)

- POST /u/proxy/ai/pipeline
- Requires authentication and CSRF header.
- Body passthrough to EVI:
  - { prompt: string, network: string, maxIters?: number, filename?: string, strictArgs?: boolean, constructorArgs?: any[], jobKind?: string }
- Behavior: Calls `${EVI_BASE_URL}/api/ai/pipeline`, returns upstream response, and if `job.id` exists, immediately attaches job to the current user.

Curl
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/proxy/ai/pipeline \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Create and deploy a TicTacToe smart contract for two players",
    "network": "basecamp",
    "maxIters": 7,
    "filename": "TicTacToe.sol",
    "strictArgs": true
  }' | jq
```

Response (passthrough)
```json
{
  "ok": true,
  "job": {
    "id": "ai_pipeline_60864155-2ac0-4f3e-b8e4-61f31f31a9ad",
    "type": "ai_pipeline",
    "state": "running",
    "progress": 5,
    "createdAt": 1761219825312,
    "updatedAt": 1761219825312,
    "payload": {
      "prompt": "Create and deploy a TicTacToe smart contract for two players",
      "network": "basecamp",
      "maxIters": 7,
      "providedName": "",
      "filename": "TicTacToe.sol",
      "constructorArgs": [],
      "strictArgs": true,
      "jobKind": "pipeline"
    },
    "step": "init",
    "stepHistory": [
      { "step": "init", "t": 1761219825312 }
    ],
    "timings": {
      "startedAt": 1761219825312,
      "endedAt": null,
      "phases": { "init": { "startedAt": 1761219825312 } }
    },
    "result": null,
    "error": null,
    "logs": [
      { "i": 1, "t": 1761219825312, "level": "info", "msg": "Pipeline started. Network=basecamp, maxIters=7, file=TicTacToe.sol, strictArgs=true" },
      { "i": 2, "t": 1761219825312, "level": "debug", "msg": "config: maxIters=7 (hardCap=12)" }
    ],
    "_logIndex": 2,
    "logsCount": 2,
    "lastLogTs": 1761219825312
  }
}
```

## Jobs — Upsert cache (write)

- POST /u/jobs/cache
- Headers: x-csrf-token: <evium_csrf>
- Body: { jobId, state, progress?, address?, fq_name?, constructor_args?, verified?, explorer_url?, completed_at? }

Curl
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X POST http://localhost:8080/u/jobs/cache \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{ "jobId": "ai_pipeline_123", "state": "completed", "progress": 100, "address": "0x...", "fq_name": "contracts/Foo.sol:Foo", "constructor_args": [], "verified": false, "completed_at": 1761211045451 }' | jq
```

Response
```json
{ "ok": true }
```

## Jobs — List

- GET /u/jobs?type=&limit=

Curl
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/jobs?type=pipeline&limit=20" | jq
```

Response
```json
{
  "ok": true,
  "jobs": [
    {
      "job_id": "ai_pipeline_123",
      "user_id": "<uuid>",
      "type": "pipeline",
      "prompt": "Create ERC20",
      "filename": "Token.sol",
      "network": "basecamp",
      "created_at": "2025-10-23T03:59:11.438Z",
      "state": "completed",
      "progress": 100,
      "address": "0x...",
      "fq_name": "contracts/Foo.sol:Foo",
      "constructor_args": [],
      "verified": false,
      "explorer_url": null,
      "completed_at": "2025-10-23T09:29:08.618Z",
      "updated_at": "2025-10-23T03:59:11.468Z"
    }
  ]
}
```

## Jobs — Get by id

- GET /u/jobs/:jobId

Curl
```bash
curl -s -b /tmp/evium.jar http://localhost:8080/u/jobs/ai_pipeline_123 | jq
```

Response
```json
{
  "ok": true,
  "job": {
    "job_id": "ai_pipeline_123",
    "user_id": "<uuid>",
    "type": "pipeline",
    "prompt": "Create ERC20",
    "filename": "Token.sol",
    "network": "basecamp",
    "created_at": "2025-10-23T03:59:11.438Z",
    "state": "completed",
    "progress": 100,
    "address": "0x...",
    "fq_name": "contracts/Foo.sol:Foo",
    "constructor_args": [],
    "verified": false,
    "explorer_url": null,
    "completed_at": "2025-10-23T09:29:08.618Z",
    "updated_at": "2025-10-23T03:59:11.468Z"
  }
}
```

## Proxy — Job detail, status, logs

- GET /u/proxy/job/:id?includeMagical=1
- GET /u/proxy/job/:id/status
- GET /u/proxy/job/:id/logs?afterIndex=&includeMagical=1
- GET /u/proxy/job/:id/logs/stream (SSE)

Notes
- Requires authentication.
- `includeMagical=1` adds derived convenience links from logs when possible.

Curl — detail
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/job/$JOB_ID?includeMagical=1" | jq
```

Curl — status
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/job/$JOB_ID/status" | jq
```

Curl — logs (polling)
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/job/$JOB_ID/logs?afterIndex=0&includeMagical=1" | jq
```

Curl — logs (SSE)
```bash
curl -s -N -b /tmp/evium.jar "http://localhost:8080/u/proxy/job/$JOB_ID/logs/stream"
```

## Proxy — Artifacts (combined, sources, abis, scripts)

- GET /u/proxy/artifacts?jobId=
- GET /u/proxy/artifacts/sources?jobId=
- GET /u/proxy/artifacts/abis?jobId=
- GET /u/proxy/artifacts/scripts?jobId=

Notes
- Requires authentication.
- Combined endpoint returns an object with any/all sections filled by upstream.

Curl — combined
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/artifacts?jobId=$JOB_ID" | jq
```

Curl — sources / abis / scripts
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/artifacts/sources?jobId=$JOB_ID" | jq
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/artifacts/abis?jobId=$JOB_ID" | jq
curl -s -b /tmp/evium.jar "http://localhost:8080/u/proxy/artifacts/scripts?jobId=$JOB_ID" | jq
```

## My Projects — Quick reference

- Create job (+auto attach): POST /u/proxy/ai/pipeline
- Attach known job: POST /u/jobs/attach
- List my jobs: GET /u/jobs?type=&limit=
- Job detail: GET /u/proxy/job/:id
- Logs: GET /u/proxy/job/:id/logs (or logs/stream)
- Artifacts: GET /u/proxy/artifacts*, Audit/Compliance wrappers
- Status: GET /u/proxy/job/:id/status

---

## Jobs — List (filters, cursor pagination)

- GET /u/jobs?type=&state=&network=&q=&limit=&cursorCreatedAt=&cursorId=

Notes
- Returns `{ ok, jobs, nextCursor }`. When `jobs.length === limit`, `nextCursor` contains `{ created_at, job_id }` for the next page.

Curl
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/jobs?type=pipeline&state=completed&network=basecamp&limit=20" | jq
```

## Jobs — Update metadata

- PATCH /u/jobs/:jobId/meta
- Body: `{ title?: string|null, description?: string|null, tags?: string[]|null }`

Curl
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X PATCH http://localhost:8080/u/jobs/ai_pipeline_123/meta \
  -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
  -d '{ "title": "TicTacToe", "description": "Two-player game", "tags": ["game","demo"] }' | jq
```

## Jobs — Soft-delete

- DELETE /u/jobs/:jobId

Curl
```bash
CSRF=$(awk '$6=="evium_csrf" {print $7}' /tmp/evium.jar | tail -n1)
curl -s -b /tmp/evium.jar -X DELETE -H "x-csrf-token: ${CSRF}" \
  http://localhost:8080/u/jobs/ai_pipeline_123 | jq
```

## Jobs — Export bundle (JSON)

- GET /u/jobs/:jobId/export
- Returns JSON with `{ job, artifacts, detail, logs }` suitable for archiving; zip packaging can be added later.

Curl
```bash
curl -s -b /tmp/evium.jar http://localhost:8080/u/jobs/ai_pipeline_123/export | jq
```

## User — Audit logs

- GET /u/audit/logs?limit=

Curl
```bash
curl -s -b /tmp/evium.jar "http://localhost:8080/u/audit/logs?limit=50" | jq
```

## Quotas on pipeline create

- POST /u/proxy/ai/pipeline now enforces entitlements and optional daily quota.
- Error codes:
  - 403 `{ code: "forbidden", message: "upgrade_required" }` when not entitled.
  - 429 `{ code: "rate_limited", message: "daily_jobs_quota_exceeded" }` when quota exceeded.
