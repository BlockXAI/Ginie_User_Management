# EVI User API — Testing Guide

This guide shows how to test the API end-to-end using the provided test scripts and raw curl commands.

## Test Scripts

| Script | Description |
|--------|-------------|
| `scripts/smoke.sh` | Quick smoke test with mock job IDs |
| `scripts/e2e_test.sh` | **Comprehensive E2E test with REAL API calls** |
| `scripts/phase1_smoke.sh` | Phase 1 feature tests (RBAC, keys) |
| `scripts/phase1_negative.sh` | Negative test cases |
| `scripts/multi_deploy.sh` | Multi-network deployment tests |

## Prerequisites

- Server running at `http://localhost:8080` (or set `BASE_URL` accordingly)
- Tools: `curl`, `bash`, optional `jq` for pretty JSON
- A reachable email inbox to receive OTPs

## Comprehensive E2E Test: e2e_test.sh (Recommended)

Script path: `Evi_User_Management/user-api/scripts/e2e_test.sh`

This script tests the **REAL** deployment pipeline with full logging. No mocking.

### Usage
```bash
export BASE_URL="http://localhost:8080"
export EVI_UPSTREAM_URL="https://evi-web-test-production.up.railway.app"
export NETWORK="avalanche-fuji"

bash Evi_User_Management/user-api/scripts/e2e_test.sh "you@example.com"
```

### What it tests
1. Health check
2. **Networks endpoint** (`/u/networks`) - lists all supported networks
3. Authentication (send OTP, verify)
4. User profile and entitlements
5. **Network validation** - tests that invalid networks are rejected
6. **REAL pipeline job creation** - creates actual smart contract
7. **Job status polling** - monitors deployment progress
8. **Job details and logs** - full deployment information
9. **Artifacts retrieval** - sources, ABIs
10. **Verification status** - checks if contract is verified
11. **Manual verification** - triggers verify if not auto-verified
12. **Upstream status check** - verifies job exists in EVI backend
13. User jobs list
14. Metrics
15. Logout

### Results
All results are saved to `scripts/results/<timestamp>/`:
- `summary.txt` - Quick overview of all test results
- `full_log.txt` - Complete execution log
- `*.json` - Individual API responses
- `cookies.txt` - Session cookies

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:8080` | User API base URL |
| `EVI_UPSTREAM_URL` | `https://evi-web-test-production.up.railway.app` | Upstream EVI API |
| `NETWORK` | `avalanche-fuji` | Target network for deployment |
| `PROMPT` | Simple counter contract | Contract prompt |

---

## Quick Smoke Test: smoke.sh

Script path: `Evi_User_Management/user-api/scripts/smoke.sh`

> **Note**: This script uses mock job IDs for quick testing. Use `e2e_test.sh` for real deployments.

- Usage:
  ```bash
  # BASE_URL defaults to http://localhost:8080
  export BASE_URL="http://localhost:8080"
  # Optional: enable wrapper job creation and set network
  export USE_WRAPPER=1
  export JOB_NETWORK=avalanche-fuji

  # Run smoke (prompts for OTP)
  bash Evi_User_Management/user-api/scripts/smoke.sh "you@example.com" "Your Name"
  ```

- What it does:
  1. Health check `/u/healthz`
  2. Send OTP `/u/auth/send-otp` to your email
  3. Verify OTP `/u/auth/verify` and write cookies to a jar (`/tmp/evium_smoke.jar` by default)
  4. Attach a test job `/u/jobs/attach` (uses CSRF from cookie jar)
  5. Upsert cache `/u/jobs/cache`
  6. List jobs `/u/jobs`
  7. Get job by id `/u/jobs/:id`
  8. Metrics `/u/metrics`
  9. Me `/u/user/me` (returns email/role)
  10. Refresh `/u/auth/refresh` (rotates access/refresh and CSRF; updates jar)
  11. [Optional if USE_WRAPPER=1] Create job via wrapper `/u/proxy/ai/pipeline` and auto-attach ownership
  12. Logout `/u/auth/logout` (clears cookies)

- Environment vars the script uses:
  - `BASE_URL` — API base, default `http://localhost:8080`
  - `COOKIE_JAR` — cookie jar path, default `/tmp/evium_smoke.jar`
  - `JOB_NETWORK` — target network for wrapper tests, default `basecamp`
  - `USE_WRAPPER` — set `1` to exercise wrapper job creation

## Manual curl testing

- Setup
  ```bash
  export USER_API="http://localhost:8080"
  export JAR="/tmp/evium.jar"
  rm -f "$JAR"
  ```

- Send OTP
  ```bash
  IDENTITY="you@example.com"
  SEND=$(curl -s -X POST "$USER_API/u/auth/send-otp" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"${IDENTITY}\",\"name\":\"You\"}")
  CHALLENGE=$(echo "$SEND" | jq -r '.challengeId // empty')
  echo "$SEND" | jq .
  ```

- Verify and write cookies
  ```bash
  OTP="<paste-otp>"
  curl -s -c "$JAR" -X POST "$USER_API/u/auth/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE}\"}" | jq .
  ```

- Read CSRF from the cookie jar
  ```bash
  CSRF=$(awk '$6=="evium_csrf" {print $7}' "$JAR" | tail -n1)
  ```

- Attach job (write; needs CSRF)
  ```bash
  curl -s -b "$JAR" -X POST "$USER_API/u/jobs/attach" \
    -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' \
    -d '{"jobId":"ai_pipeline_123","type":"pipeline","network":"basecamp"}' | jq .
  ```

- Me (shows email/role)
  ```bash
  curl -s -b "$JAR" "$USER_API/u/user/me" | jq .
  ```

- Refresh (rotate cookies and CSRF) — use both -b and -c
  ```bash
  curl -s -b "$JAR" -c "$JAR" -X POST "$USER_API/u/auth/refresh" | jq .
  CSRF=$(awk '$6=="evium_csrf" {print $7}' "$JAR" | tail -n1)
  ```

- Wrapper: create pipeline job (optional; needs CSRF)
  ```bash
  curl -s -b "$JAR" -X POST "$USER_API/u/proxy/ai/pipeline" \
    -H "x-csrf-token: $CSRF" -H 'Content-Type: application/json' \
    -d '{"prompt":"Smoke Test","network":"basecamp","filename":"Smoke.sol"}' | jq .
  ```

- Logout (use -b and -c)
  ```bash
  curl -s -b "$JAR" -c "$JAR" -X POST "$USER_API/u/auth/logout" | jq .
  ```

## Common pitfalls

- **Unauthorized (401) after login**: You likely overwrote the cookie jar by using `-c "$JAR"` on a request that didn’t set cookies. Use `-b "$JAR"` for normal calls; use `-b "$JAR" -c "$JAR"` only for verify/refresh/logout where cookies are set.
- **Forbidden (403) on write routes**: Missing or wrong CSRF header. Extract `evium_csrf` from the jar and send `x-csrf-token: <value>`.
- **Invalid OTP**: Identity mismatch (OTP tied to the email used in send-otp), or expired/used OTP.
- **CORS/cookies not sent from frontend**: Ensure server `APP_URL` matches your frontend origin and that frontend uses `credentials: 'include'`.

## Troubleshooting

- Check envs: `APP_URL`, `EVI_BASE_URL`, `TURNSTILE_SECRET_KEY` (if CAPTCHA enabled), `TRUST_PROXY` when behind a proxy/CDN.
- Inspect jar contents: `cat "$JAR"` or `grep evium_access "$JAR"`.
- Logs: Server prints JSON access/error logs; Sentry can be enabled with `SENTRY_DSN`.

## What this validates

- OTP auth lifecycle (send → verify → cookies)
- CSRF-protected writes
- Redis-backed rate limits
- Ownership linkage and cache upserts
- Metrics endpoint
- Refresh rotation of access/refresh + CSRF
- Optional wrapper: proxy job creation and auto-attach

## Auth modes — targeted curl examples

The OTP endpoints support an optional `mode` hint:
- `auto` (default): create on first login if user doesn’t exist
- `signin`: require existing user (404 if not found)
- `signup`: require new user (409 if already exists)

Setup
```bash
export USER_API="http://localhost:8080"
export JAR="/tmp/evium_modes.jar"
rm -f "$JAR"
```

Dev helper (to read OTP in development)
```bash
# Only works when OTP_PROVIDER_MODE=dev
curl -s "${USER_API}/u/dev/otp?email=you@example.com" | jq
```

### Create account (signup)
```bash
IDENTITY="newuser@example.com"
NAME="New User"
SEND=$(curl -s -X POST "${USER_API}/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\",\"mode\":\"signup\"}")
CHALLENGE=$(echo "$SEND" | jq -r '.challengeId // empty')
OTP=$(curl -s "${USER_API}/u/dev/otp?email=${IDENTITY}" | jq -r '.code // empty')

curl -s -c "$JAR" -X POST "${USER_API}/u/auth/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE}\",\"mode\":\"signup\",\"name\":\"${NAME}\"}" | jq .
```

### Sign in (existing user)
```bash
IDENTITY="existing@example.com"
NAME="Existing"
SEND=$(curl -s -X POST "${USER_API}/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\",\"mode\":\"signin\"}")
CHALLENGE=$(echo "$SEND" | jq -r '.challengeId // empty')
OTP=$(curl -s "${USER_API}/u/dev/otp?email=${IDENTITY}" | jq -r '.code // empty')

curl -s -c "$JAR" -X POST "${USER_API}/u/auth/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE}\",\"mode\":\"signin\"}" | jq .
```

### Auto mode (default)
```bash
IDENTITY="auto@example.com"
NAME="Auto User"
SEND=$(curl -s -X POST "${USER_API}/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\"}")
CHALLENGE=$(echo "$SEND" | jq -r '.challengeId // empty')
OTP=$(curl -s "${USER_API}/u/dev/otp?email=${IDENTITY}" | jq -r '.code // empty')

curl -s -c "$JAR" -X POST "${USER_API}/u/auth/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE}\"}" | jq .
```

### Negative cases
```bash
# signin for non-existent → 404
curl -s -i -X POST "${USER_API}/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"nouser@example.com","name":"No User","mode":"signin"}'

# signup for existing → 409
curl -s -i -X POST "${USER_API}/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"existing@example.com","name":"Existing","mode":"signup"}'

# invalid OTP → 401
curl -s -i -X POST "${USER_API}/u/auth/verify" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"auto@example.com","otp":"000000"}'
