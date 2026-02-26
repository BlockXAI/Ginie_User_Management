#!/usr/bin/env bash
#
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  FULL DApp Integration E2E Test Script                                     ║
# ║                                                                            ║
# ║  Tests the COMPLETE user flow through user-api:                            ║
# ║    • Auth (OTP login, session reuse, refresh, CSRF)                        ║
# ║    • User profile & entitlements                                           ║
# ║    • Smart Contract Pipeline (create → poll → artifacts → verify/audit)    ║
# ║    • Frontend Builder (create → list → detail → files → download)          ║
# ║    • DApp Integration (create dapp → list dapps → get contracts)           ║
# ║    • Service-to-Service endpoints (/u/service/*)                           ║
# ║    • Job management (list → update meta → export → delete)                 ║
# ║    • SSE events stream & WebSocket tunnel                                  ║
# ║                                                                            ║
# ║  Login happens ONCE. Session is reused across all tests via cookie jar.    ║
# ║                                                                            ║
# ║  Usage:                                                                    ║
# ║    bash scripts/dapp_full_e2e.sh [email] [name]                            ║
# ║                                                                            ║
# ║  Environment variables:                                                    ║
# ║    BASE_URL              user-api base (default: http://localhost:8080)     ║
# ║    COOKIE_JAR            cookie file (default: /tmp/evium_dapp_e2e.jar)    ║
# ║    USERAPI_SERVICE_SECRET  service token for /u/service/* tests            ║
# ║    FORCE_LOGIN=1         skip session reuse, force fresh OTP               ║
# ║    SKIP_ENTITLEMENT_CHECK=1  continue even without pro_enabled             ║
# ║    SKIP_PIPELINE=1       skip the long-running pipeline test               ║
# ║    PIPELINE_TIMEOUT      seconds to wait for pipeline (default: 300)       ║
# ║    RUN_GITHUB_EXPORT=1   test GitHub export (creates a repo)               ║
# ║    NETWORK               blockchain network (default: avalanche-fuji)      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#

set -u
set +e

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_URL=${BASE_URL:-http://localhost:8080}
IDENTITY=${1:-arpit@compliledger.com}
NAME=${2:-Arpit}
COOKIE_JAR=${COOKIE_JAR:-/tmp/evium_dapp_e2e.jar}
FORCE_LOGIN=${FORCE_LOGIN:-0}
SKIP_ENTITLEMENT_CHECK=${SKIP_ENTITLEMENT_CHECK:-0}
SKIP_PIPELINE=${SKIP_PIPELINE:-0}
PIPELINE_TIMEOUT=${PIPELINE_TIMEOUT:-300}
RUN_GITHUB_EXPORT=${RUN_GITHUB_EXPORT:-0}
NETWORK=${NETWORK:-avalanche-fuji}
USERAPI_SERVICE_SECRET=${USERAPI_SERVICE_SECRET:-dev-service-secret-change-me-in-production}

# ─── Colors & formatting ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── Counters ─────────────────────────────────────────────────────────────────
pass_count=0
fail_count=0
warn_count=0
skip_count=0

# ─── Helpers ──────────────────────────────────────────────────────────────────
jq_installed() { command -v jq >/dev/null 2>&1; }
read_cookie() { awk -v n="$1" '$6==n {print $7}' "$COOKIE_JAR" 2>/dev/null | tail -n1 || true; }
read_csrf() { awk '$6=="evium_csrf" {print $7}' "$COOKIE_JAR" 2>/dev/null | tail -n1 || true; }

print_pass() { echo -e "  ${GREEN}✓ PASS${NC} - $1"; ((pass_count++)); }
print_fail() { echo -e "  ${RED}✗ FAIL${NC} - $1"; ((fail_count++)); }
print_warn() { echo -e "  ${YELLOW}⚠ WARN${NC} - $1"; ((warn_count++)); }
print_skip() { echo -e "  ${DIM}⊘ SKIP${NC} - $1"; ((skip_count++)); }
print_info() { echo -e "  ${DIM}ℹ ${NC}$1"; }

section() {
  echo ""
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  $1${NC}"
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
}

step() {
  echo ""
  echo -e "${BOLD}  [$1] $2${NC}"
}

# ─── API call helper (cookie-auth, auto-CSRF) ────────────────────────────────
# Usage: api_json METHOD PATH [JSON_BODY]
# Returns: body\nHTTP_CODE  (last line is always the status code)
api_json() {
  local method=$1
  local path=$2
  local data=${3:-}
  local extra_headers=()

  local csrf
  csrf=$(read_csrf)
  if [[ -n "${csrf}" ]]; then
    extra_headers+=( -H "x-csrf-token: ${csrf}" )
  fi

  if [[ "$method" == "GET" ]]; then
    curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      "${extra_headers[@]}" \
      "${BASE_URL}${path}"
    return
  fi

  curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X "$method" -H 'Content-Type: application/json' \
    "${extra_headers[@]}" \
    -d "$data" \
    "${BASE_URL}${path}"
}

# ─── Service-to-service call helper (Bearer token + X-User-Id) ───────────────
# Usage: svc_json METHOD PATH [JSON_BODY] [USER_ID]
svc_json() {
  local method=$1
  local path=$2
  local data=${3:-}
  local user_id=${4:-$USER_ID}

  if [[ "$method" == "GET" ]]; then
    curl -sS -w "\n%{http_code}" \
      -H "Authorization: Bearer ${USERAPI_SERVICE_SECRET}" \
      -H "X-User-Id: ${user_id}" \
      "${BASE_URL}${path}"
    return
  fi

  curl -sS -w "\n%{http_code}" \
    -X "$method" -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${USERAPI_SERVICE_SECRET}" \
    -H "X-User-Id: ${user_id}" \
    -d "$data" \
    "${BASE_URL}${path}"
}

# ─── Response parsing helpers ─────────────────────────────────────────────────
get_http_code() { echo "$1" | tail -n1; }
get_body()      { echo "$1" | sed '$d'; }
is_2xx()        { [[ "$1" =~ ^2 ]]; }

# ─── Assert helper: checks HTTP code + prints pass/fail ──────────────────────
# Usage: assert_http "description" "$RESPONSE" [expected_code_prefix]
assert_http() {
  local desc=$1
  local resp=$2
  local expected=${3:-2}  # default: 2xx
  local code
  code=$(get_http_code "$resp")
  if [[ "$code" == "${expected}"* ]]; then
    print_pass "$desc (HTTP $code)"
    return 0
  else
    print_fail "$desc (HTTP $code, expected ${expected}xx)"
    print_info "Response: $(get_body "$resp" | head -c 500)"
    return 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
touch "$COOKIE_JAR" 2>/dev/null || true

if ! jq_installed; then
  echo "ERROR: jq is required. Install it first." >&2
  exit 1
fi

echo ""
echo -e "${BOLD}DApp Full E2E Test${NC}"
echo -e "${DIM}Base URL:  ${BASE_URL}${NC}"
echo -e "${DIM}Identity:  ${IDENTITY}${NC}"
echo -e "${DIM}Network:   ${NETWORK}${NC}"
echo -e "${DIM}Cookie:    ${COOKIE_JAR}${NC}"
echo -e "${DIM}Started:   $(date)${NC}"

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 1: HEALTH & AUTH                                               ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 1: Health Check & Authentication"

# ─── 1.1 Health check ────────────────────────────────────────────────────────
step "1.1" "Health check — GET /u/healthz"
print_info "Verifies user-api is running and DB + Redis are connected."
RESP=$(curl -sS -w "\n%{http_code}" "${BASE_URL}/u/healthz")
if ! assert_http "/u/healthz" "$RESP"; then
  echo "user-api is not healthy. Aborting."
  exit 1
fi

# ─── 1.2 Auth: reuse session or OTP login ─────────────────────────────────────
step "1.2" "Authentication — reuse session or OTP login"
print_info "Tries to reuse existing cookies from ${COOKIE_JAR}."
print_info "If session is expired, attempts refresh. If that fails, does fresh OTP login."
print_info "This ensures we only log in ONCE for the entire test run."

AUTH_OK=0
USER_ID=""

if [[ "$FORCE_LOGIN" != "1" ]]; then
  ACCESS=$(read_cookie "evium_access")
  if [[ -n "$ACCESS" ]]; then
    # Try /u/user/me with existing cookie
    RESP=$(api_json GET "/u/user/me")
    CODE=$(get_http_code "$RESP")
    if is_2xx "$CODE"; then
      AUTH_OK=1
      USER_ID=$(get_body "$RESP" | jq -r '.user.id // empty')
      print_pass "Reused existing session (user_id=${USER_ID})"
    else
      # Session expired — try refresh
      print_info "Session expired (HTTP $CODE). Attempting token refresh..."
      REFRESH=$(curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "${BASE_URL}/u/auth/refresh")
      RCODE=$(get_http_code "$REFRESH")
      if is_2xx "$RCODE"; then
        RESP2=$(api_json GET "/u/user/me")
        CODE2=$(get_http_code "$RESP2")
        if is_2xx "$CODE2"; then
          AUTH_OK=1
          USER_ID=$(get_body "$RESP2" | jq -r '.user.id // empty')
          print_pass "Refreshed session successfully (user_id=${USER_ID})"
        fi
      fi
    fi
  fi
fi

if [[ "$AUTH_OK" != "1" ]]; then
  print_info "No valid session found. Starting fresh OTP login."

  step "1.2a" "Send OTP — POST /u/auth/send-otp"
  print_info "Sends a one-time password to ${IDENTITY}."
  print_info "Body: {identity, name, mode:'auto'}"
  RESP=$(curl -sS -w "\n%{http_code}" -X POST "${BASE_URL}/u/auth/send-otp" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\",\"mode\":\"auto\"}")
  CODE=$(get_http_code "$RESP")
  BODY=$(get_body "$RESP")
  if ! is_2xx "$CODE"; then
    print_fail "send-otp (HTTP $CODE)"
    echo "$BODY"
    exit 1
  fi
  print_pass "send-otp (HTTP $CODE)"

  CHALLENGE_ID=$(echo "$BODY" | jq -r '.challengeId // empty')
  if [[ -z "$CHALLENGE_ID" || "$CHALLENGE_ID" == "null" ]]; then
    print_fail "No challengeId returned — cannot verify OTP"
    echo "$BODY"
    exit 1
  fi
  print_info "challengeId = ${CHALLENGE_ID}"

  read -r -p "  Enter OTP sent to ${IDENTITY}: " OTP

  step "1.2b" "Verify OTP — POST /u/auth/verify"
  print_info "Verifies the OTP and sets evium_access, evium_refresh, evium_csrf cookies."
  print_info "Body: {identity, otp, challengeId}"
  RESP=$(curl -sS -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "${BASE_URL}/u/auth/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE_ID}\"}")
  CODE=$(get_http_code "$RESP")
  BODY=$(get_body "$RESP")
  if ! is_2xx "$CODE"; then
    print_fail "verify (HTTP $CODE)"
    echo "$BODY"
    exit 1
  fi
  print_pass "verify (HTTP $CODE)"
  USER_ID=$(echo "$BODY" | jq -r '.user.id // empty')
  print_info "user_id = ${USER_ID}"
fi

# ─── 1.3 Verify cookies are present ──────────────────────────────────────────
step "1.3" "Verify auth cookies"
CSRF=$(read_csrf)
ACCESS=$(read_cookie "evium_access")
REFRESH_CK=$(read_cookie "evium_refresh")

[[ -n "$ACCESS" ]]    && print_pass "evium_access cookie present" || print_fail "evium_access cookie MISSING"
[[ -n "$REFRESH_CK" ]] && print_pass "evium_refresh cookie present" || print_fail "evium_refresh cookie MISSING"
[[ -n "$CSRF" ]]       && print_pass "evium_csrf cookie present (CSRF token for write endpoints)" || print_fail "evium_csrf cookie MISSING"

if [[ -z "$CSRF" ]]; then
  echo "Cannot proceed without CSRF token. Aborting."
  exit 1
fi

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 2: USER PROFILE & ENTITLEMENTS                                 ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 2: User Profile & Entitlements"

# ─── 2.1 GET /u/user/me ──────────────────────────────────────────────────────
step "2.1" "User profile — GET /u/user/me"
print_info "Returns authenticated user info + entitlements."
print_info "Used by Ginie AuthProvider on every page load."
RESP=$(api_json GET "/u/user/me")
assert_http "/u/user/me" "$RESP"
ME_BODY=$(get_body "$RESP")
USER_EMAIL=$(echo "$ME_BODY" | jq -r '.user.email // "unknown"')
USER_ROLE=$(echo "$ME_BODY" | jq -r '.user.role // "unknown"')
print_info "Email: ${USER_EMAIL}  |  Role: ${USER_ROLE}"
echo "$ME_BODY" | jq '.entitlements // {}' 2>/dev/null | head -20

# ─── 2.2 Check pro_enabled entitlement ────────────────────────────────────────
step "2.2" "Entitlement check — pro_enabled"
print_info "Most builder/DApp endpoints require pro_enabled entitlement."
PRO_ENABLED=$(echo "$ME_BODY" | jq -r '.entitlements.pro_enabled // false')
if [[ "$PRO_ENABLED" == "true" ]]; then
  print_pass "pro_enabled = true"
else
  if [[ "$SKIP_ENTITLEMENT_CHECK" == "1" ]]; then
    print_warn "pro_enabled = false (continuing because SKIP_ENTITLEMENT_CHECK=1)"
  else
    print_fail "pro_enabled = false (builder/DApp endpoints will 403)"
    echo "Set SKIP_ENTITLEMENT_CHECK=1 to continue anyway."
    exit 1
  fi
fi

# ─── 2.3 Update profile (optional write test) ────────────────────────────────
step "2.3" "Update profile — POST /u/user/profile"
print_info "Tests a CSRF-protected write endpoint. Sends x-csrf-token header."
print_info "Body: {display_name, profile: {organization, role}}"
RESP=$(api_json POST "/u/user/profile" "{\"display_name\":\"${NAME}\",\"profile\":{\"organization\":\"E2E Test\",\"role\":\"tester\"}}")
assert_http "/u/user/profile" "$RESP"

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 3: SMART CONTRACT PIPELINE                                     ║
# ║  Tests the complete contract deployment flow through user-api proxy      ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 3: Smart Contract Pipeline (via /u/proxy/ai/pipeline)"

JOB_ID=""
PIPELINE_PROMPT="Create a simple ERC20 token called TestToken with symbol TST and 1000 initial supply"

if [[ "$SKIP_PIPELINE" == "1" ]]; then
  step "3.1" "Pipeline — SKIPPED (SKIP_PIPELINE=1)"
  print_skip "Pipeline creation skipped. Set SKIP_PIPELINE=0 to enable."
  print_info "Will skip pipeline-dependent tests (job status, artifacts, verify, audit)."
else
  # ─── 3.1 Create pipeline ─────────────────────────────────────────────────
  step "3.1" "Create pipeline — POST /u/proxy/ai/pipeline"
  print_info "Creates a smart contract generation + compilation + deployment job."
  print_info "This is the SAME endpoint Ginie uses when a user submits a contract prompt."
  print_info "Body: {prompt, network:'${NETWORK}', maxIters:5}"
  print_info "Prompt: '${PIPELINE_PROMPT}'"
  RESP=$(api_json POST "/u/proxy/ai/pipeline" \
    "{\"prompt\":\"${PIPELINE_PROMPT}\",\"network\":\"${NETWORK}\",\"maxIters\":5}")
  CODE=$(get_http_code "$RESP")
  BODY=$(get_body "$RESP")
  if is_2xx "$CODE"; then
    print_pass "pipeline create (HTTP $CODE)"
    JOB_ID=$(echo "$BODY" | jq -r '.job.id // .jobId // .id // .data.jobId // empty')
    if [[ -n "$JOB_ID" && "$JOB_ID" != "null" ]]; then
      print_pass "job_id = ${JOB_ID}"
    else
      print_fail "No job_id returned in pipeline response"
      echo "$BODY" | jq . 2>/dev/null | head -20
      JOB_ID=""
    fi
  else
    print_fail "pipeline create (HTTP $CODE)"
    echo "$BODY" | head -c 500
    JOB_ID=""
  fi

  if [[ -n "$JOB_ID" ]]; then
    # ─── 3.2 Poll job status until done ──────────────────────────────────
    step "3.2" "Poll job status — GET /u/proxy/job/:id/status"
    print_info "Polls every 5s until state=completed|failed or timeout (${PIPELINE_TIMEOUT}s)."
    print_info "This is EXACTLY how Ginie's chat page polls for pipeline progress."
    print_info "Response shape: {ok, data: {id, state, progress, result: {address, fq_name}}}"

    START_TIME=$(date +%s)
    FINAL_STATE=""
    CONTRACT_ADDRESS=""
    FQ_NAME=""

    while true; do
      ELAPSED=$(( $(date +%s) - START_TIME ))
      if [[ "$ELAPSED" -ge "$PIPELINE_TIMEOUT" ]]; then
        print_fail "Pipeline timed out after ${PIPELINE_TIMEOUT}s"
        break
      fi

      RESP=$(api_json GET "/u/proxy/job/${JOB_ID}/status?verbose=1&includeMagical=1")
      CODE=$(get_http_code "$RESP")
      BODY=$(get_body "$RESP")

      if ! is_2xx "$CODE"; then
        print_info "Status poll returned HTTP $CODE (retrying in 5s)..."
        sleep 5
        continue
      fi

      STATE=$(echo "$BODY" | jq -r '.data.state // .state // "unknown"')
      PROGRESS=$(echo "$BODY" | jq -r '.data.progress // .progress // 0')
      printf "  ${DIM}  [%3ds] state=%-12s progress=%s%%${NC}\n" "$ELAPSED" "$STATE" "$PROGRESS"

      if [[ "$STATE" == "completed" || "$STATE" == "failed" ]]; then
        FINAL_STATE="$STATE"
        CONTRACT_ADDRESS=$(echo "$BODY" | jq -r '.data.result.address // .result.address // empty')
        FQ_NAME=$(echo "$BODY" | jq -r '.data.result.fq_name // .result.fq_name // empty')
        break
      fi

      sleep 5
    done

    if [[ "$FINAL_STATE" == "completed" ]]; then
      print_pass "Pipeline completed in ${ELAPSED}s"
      if [[ -n "$CONTRACT_ADDRESS" ]]; then
        print_pass "Contract deployed: ${CONTRACT_ADDRESS}"
        print_info "Fully qualified name: ${FQ_NAME}"
      else
        print_warn "Pipeline completed but no contract address in result"
      fi
    elif [[ "$FINAL_STATE" == "failed" ]]; then
      print_fail "Pipeline failed"
      print_info "Error: $(echo "$BODY" | jq -r '.data.error // .error // "unknown"')"
    fi

    # ─── 3.3 Job detail ──────────────────────────────────────────────────
    step "3.3" "Job detail — GET /u/proxy/job/:id"
    print_info "Returns full job info including payload, result, logs."
    print_info "Used by Ginie's chat page for the expanded job view."
    RESP=$(api_json GET "/u/proxy/job/${JOB_ID}?includeMagical=1")
    assert_http "/u/proxy/job/${JOB_ID}" "$RESP"

    # ─── 3.4 Job logs ────────────────────────────────────────────────────
    step "3.4" "Job logs — GET /u/proxy/job/:id/logs"
    print_info "Returns paginated compilation/deployment logs."
    print_info "Used by Ginie to show real-time build output."
    RESP=$(api_json GET "/u/proxy/job/${JOB_ID}/logs?afterIndex=0&limit=10")
    assert_http "/u/proxy/job/${JOB_ID}/logs" "$RESP"
    LOG_COUNT=$(get_body "$RESP" | jq -r '.data.count // .count // 0')
    print_info "Log entries: ${LOG_COUNT}"

    # ─── 3.5 Artifacts ───────────────────────────────────────────────────
    step "3.5" "Artifacts — GET /u/proxy/artifacts?jobId=X"
    print_info "Returns sources, ABIs, and scripts for a completed job."
    print_info "Used by Ginie to display contract source code and ABI."
    RESP=$(api_json GET "/u/proxy/artifacts?jobId=${JOB_ID}&include=all")
    assert_http "/u/proxy/artifacts" "$RESP"
    SOURCES_COUNT=$(get_body "$RESP" | jq -r '.sources | length // 0' 2>/dev/null)
    ABIS_COUNT=$(get_body "$RESP" | jq -r '.abis | length // 0' 2>/dev/null)
    print_info "Sources: ${SOURCES_COUNT}  |  ABIs: ${ABIS_COUNT}"

    step "3.5b" "Artifact sources — GET /u/proxy/artifacts/sources?jobId=X"
    RESP=$(api_json GET "/u/proxy/artifacts/sources?jobId=${JOB_ID}")
    assert_http "/u/proxy/artifacts/sources" "$RESP"

    step "3.5c" "Artifact ABIs — GET /u/proxy/artifacts/abis?jobId=X"
    RESP=$(api_json GET "/u/proxy/artifacts/abis?jobId=${JOB_ID}")
    assert_http "/u/proxy/artifacts/abis" "$RESP"

    # ─── 3.6 Verification ────────────────────────────────────────────────
    if [[ "$FINAL_STATE" == "completed" && -n "$CONTRACT_ADDRESS" ]]; then
      step "3.6" "Verify contract — POST /u/proxy/verify/byJob"
      print_info "Submits the contract for verification on the block explorer."
      print_info "Body: {jobId, network:'${NETWORK}'}"
      RESP=$(api_json POST "/u/proxy/verify/byJob" "{\"jobId\":\"${JOB_ID}\",\"network\":\"${NETWORK}\"}")
      CODE=$(get_http_code "$RESP")
      if is_2xx "$CODE"; then
        print_pass "verify/byJob (HTTP $CODE)"
        VERIFIED=$(get_body "$RESP" | jq -r '.verified // false')
        EXPLORER=$(get_body "$RESP" | jq -r '.explorerUrl // empty')
        print_info "Verified: ${VERIFIED}  |  Explorer: ${EXPLORER}"
      else
        print_warn "verify/byJob (HTTP $CODE) — verification may not be available for ${NETWORK}"
      fi
    else
      step "3.6" "Verify contract — SKIPPED (pipeline not completed)"
      print_skip "No deployed contract to verify"
    fi

    # ─── 3.7 Audit ───────────────────────────────────────────────────────
    step "3.7" "Audit contract — POST /u/proxy/audit/byJob"
    print_info "Runs AI security audit on the deployed contract's source code."
    print_info "Body: {jobId, model:'gemini-2.0-flash'}"
    RESP=$(api_json POST "/u/proxy/audit/byJob?format=md" "{\"jobId\":\"${JOB_ID}\",\"model\":\"gemini-2.0-flash\",\"policy\":{}}")
    CODE=$(get_http_code "$RESP")
    if is_2xx "$CODE"; then
      print_pass "audit/byJob (HTTP $CODE)"
    else
      print_warn "audit/byJob (HTTP $CODE) — audit may take time or be unavailable"
    fi

    # ─── 3.8 Compliance ──────────────────────────────────────────────────
    step "3.8" "Compliance check — POST /u/proxy/compliance/byJob"
    print_info "Runs regulatory compliance check on the contract."
    print_info "Body: {jobId, model:'gemini-2.0-flash'}"
    RESP=$(api_json POST "/u/proxy/compliance/byJob?format=md" "{\"jobId\":\"${JOB_ID}\",\"model\":\"gemini-2.0-flash\",\"policy\":{}}")
    CODE=$(get_http_code "$RESP")
    if is_2xx "$CODE"; then
      print_pass "compliance/byJob (HTTP $CODE)"
    else
      print_warn "compliance/byJob (HTTP $CODE)"
    fi
  fi  # end JOB_ID check
fi  # end SKIP_PIPELINE check

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 4: JOB MANAGEMENT                                             ║
# ║  Tests the /u/jobs/* endpoints used by Ginie's projects page            ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 4: Job Management (/u/jobs/*)"

# ─── 4.1 List user jobs ──────────────────────────────────────────────────────
step "4.1" "List user jobs — GET /u/jobs"
print_info "Paginated list of all jobs owned by the user."
print_info "Supports filters: ?type=pipeline&state=completed&network=${NETWORK}&q=search&limit=20"
print_info "Used by Ginie's Projects page to show the Smart Contract Jobs section."
RESP=$(api_json GET "/u/jobs?limit=10")
assert_http "/u/jobs" "$RESP"
JOBS_COUNT=$(get_body "$RESP" | jq -r '.jobs | length' 2>/dev/null)
print_info "Jobs returned: ${JOBS_COUNT}"

# ─── 4.1b Filtered list ──────────────────────────────────────────────────────
step "4.1b" "List jobs filtered — GET /u/jobs?network=${NETWORK}"
RESP=$(api_json GET "/u/jobs?network=${NETWORK}&limit=5")
assert_http "/u/jobs?network=${NETWORK}" "$RESP"

if [[ -n "$JOB_ID" ]]; then
  # ─── 4.2 Get single job ─────────────────────────────────────────────────
  step "4.2" "Get user job — GET /u/jobs/:jobId"
  print_info "Returns the user-owned job record with metadata (title, tags, prompt)."
  RESP=$(api_json GET "/u/jobs/${JOB_ID}")
  assert_http "/u/jobs/${JOB_ID}" "$RESP"

  # ─── 4.3 Update job meta ────────────────────────────────────────────────
  step "4.3" "Update job meta — PATCH /u/jobs/:jobId/meta"
  print_info "Updates user-editable fields: title, description, tags."
  print_info "Used when user renames a project in Ginie."
  RESP=$(api_json PATCH "/u/jobs/${JOB_ID}/meta" "{\"title\":\"E2E Test Token\",\"description\":\"Created by dapp_full_e2e.sh\",\"tags\":[\"e2e\",\"test\"]}")
  assert_http "PATCH /u/jobs/${JOB_ID}/meta" "$RESP"

  # ─── 4.4 Update job cache ───────────────────────────────────────────────
  step "4.4" "Update job cache — POST /u/jobs/cache"
  print_info "Caches job state/progress/address for fast queries without hitting upstream."
  print_info "Called by Ginie after receiving status updates via SSE."
  RESP=$(api_json POST "/u/jobs/cache" "{\"jobId\":\"${JOB_ID}\",\"state\":\"completed\",\"progress\":100}")
  assert_http "POST /u/jobs/cache" "$RESP"

  # ─── 4.5 Export job ─────────────────────────────────────────────────────
  step "4.5" "Export job — GET /u/jobs/:jobId/export"
  print_info "Returns a JSON bundle of the job (for downloading/sharing)."
  RESP=$(api_json GET "/u/jobs/${JOB_ID}/export")
  assert_http "/u/jobs/${JOB_ID}/export" "$RESP"
else
  step "4.2-4.5" "Job detail/update/export — SKIPPED (no JOB_ID)"
  print_skip "Pipeline was skipped or failed, no job to test against."
fi

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 5: FRONTEND BUILDER                                           ║
# ║  Tests the builder wrapper endpoints used by Ginie's builder mode       ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 5: Frontend Builder (/u/proxy/builder/*)"

BUILDER_PROJECT_ID=""

# ─── 5.1 Create builder project ──────────────────────────────────────────────
step "5.1" "Create builder project — POST /u/proxy/builder/projects"
print_info "Creates a new frontend project via Frontend_Builder /chat endpoint."
print_info "Requires: pro_enabled entitlement + CSRF header."
print_info "Body: {prompt: '...'}"
BUILDER_PROMPT="Build a simple counter app with increment and decrement buttons using React and Tailwind CSS"
RESP=$(api_json POST "/u/proxy/builder/projects" "{\"prompt\":\"${BUILDER_PROMPT}\"}")
CODE=$(get_http_code "$RESP")
BODY=$(get_body "$RESP")
if is_2xx "$CODE"; then
  print_pass "builder create (HTTP $CODE)"
  BUILDER_PROJECT_ID=$(echo "$BODY" | jq -r '.project.id // empty')
  if [[ -n "$BUILDER_PROJECT_ID" && "$BUILDER_PROJECT_ID" != "null" ]]; then
    print_pass "project.id = ${BUILDER_PROJECT_ID}"
  else
    print_fail "No project.id in create response"
    echo "$BODY" | jq . 2>/dev/null | head -20
  fi
else
  print_fail "builder create (HTTP $CODE)"
  print_info "Response: $(echo "$BODY" | head -c 300)"
fi

# ─── 5.2 List builder projects ────────────────────────────────────────────────
step "5.2" "List builder projects — GET /u/proxy/builder/projects"
print_info "Lists all builder projects (with optional ?refresh=1 to sync statuses)."
print_info "Used by Ginie's Projects page Frontend Builder section."
RESP=$(api_json GET "/u/proxy/builder/projects?limit=20")
assert_http "builder list" "$RESP"
PROJ_COUNT=$(get_body "$RESP" | jq -r '.projects | length' 2>/dev/null)
print_info "Projects returned: ${PROJ_COUNT}"

if [[ -n "$BUILDER_PROJECT_ID" ]]; then
  FOUND=$(get_body "$RESP" | jq --arg id "$BUILDER_PROJECT_ID" '[.projects[]?.id] | index($id) != null')
  if [[ "$FOUND" == "true" ]]; then
    print_pass "Created project found in list"
  else
    print_warn "Created project NOT found in list (possible caching delay)"
  fi
fi

if [[ -n "$BUILDER_PROJECT_ID" ]]; then
  # ─── 5.3 Project detail ───────────────────────────────────────────────
  step "5.3" "Project detail — GET /u/proxy/builder/projects/:id"
  print_info "Returns project info with optional ?includeMessages=1 for chat history."
  print_info "Used by Ginie's chat page in builder mode."
  RESP=$(api_json GET "/u/proxy/builder/projects/${BUILDER_PROJECT_ID}?includeMessages=1")
  assert_http "builder detail" "$RESP"

  # ─── 5.4 Project status ───────────────────────────────────────────────
  step "5.4" "Project status — GET /u/proxy/builder/projects/:id/status"
  print_info "Returns build status from Frontend_Builder (building/completed/failed)."
  RESP=$(api_json GET "/u/proxy/builder/projects/${BUILDER_PROJECT_ID}/status")
  assert_http "builder status" "$RESP"
  BUILD_STATUS=$(get_body "$RESP" | jq -r '.status.build_status // .status.status // "unknown"' 2>/dev/null)
  print_info "Build status: ${BUILD_STATUS}"

  # ─── 5.5 SSE events stream ────────────────────────────────────────────
  step "5.5" "SSE events stream — GET /u/proxy/builder/projects/:id/events/stream"
  print_info "Server-Sent Events bridge: user-api opens a WS to Frontend_Builder"
  print_info "and relays messages as SSE events to the browser."
  print_info "Events: ready, upstream_open, message, upstream_close, error."
  SSE_OUT="/tmp/evium_dapp_sse_${BUILDER_PROJECT_ID}.txt"
  rm -f "$SSE_OUT"
  curl -sS -N -b "$COOKIE_JAR" -H 'Accept: text/event-stream' \
    -H "x-csrf-token: ${CSRF}" \
    --max-time 8 "${BASE_URL}/u/proxy/builder/projects/${BUILDER_PROJECT_ID}/events/stream" \
    >"$SSE_OUT" 2>/dev/null || true
  if grep -q "event: ready" "$SSE_OUT" 2>/dev/null; then
    print_pass "SSE: 'ready' event received"
  else
    print_warn "SSE: no 'ready' event (builder may be idle or buffering)"
  fi
  if grep -q "event: upstream_open" "$SSE_OUT" 2>/dev/null; then
    print_pass "SSE: 'upstream_open' event received"
  else
    print_warn "SSE: no 'upstream_open' event"
  fi

  # ─── 5.6 Files list ───────────────────────────────────────────────────
  step "5.6" "Files list — GET /u/proxy/builder/projects/:id/files"
  print_info "Returns list of generated files in the builder sandbox."
  print_info "May be empty if build hasn't finished yet — retries up to 30s."
  FILES_OK=0
  for i in $(seq 1 6); do
    RESP=$(api_json GET "/u/proxy/builder/projects/${BUILDER_PROJECT_ID}/files")
    CODE=$(get_http_code "$RESP")
    BODY=$(get_body "$RESP")
    if is_2xx "$CODE"; then
      COUNT=$(echo "$BODY" | jq -r '.files | length' 2>/dev/null)
      if [[ "$COUNT" =~ ^[0-9]+$ ]] && [[ "$COUNT" -gt 0 ]]; then
        FILES_OK=1
        print_pass "Files list: ${COUNT} files found"
        break
      fi
    fi
    sleep 5
  done
  if [[ "$FILES_OK" != "1" ]]; then
    print_warn "Files list empty after retries (build may still be running)"
  fi

  # ─── 5.7 File content ─────────────────────────────────────────────────
  if [[ "$FILES_OK" == "1" ]]; then
    step "5.7" "File content — GET /u/proxy/builder/projects/:id/file?path=X"
    ONE_PATH=$(echo "$BODY" | jq -r '.files[0]')
    if [[ -n "$ONE_PATH" && "$ONE_PATH" != "null" ]]; then
      ENCODED_PATH=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$ONE_PATH")
      RESP=$(api_json GET "/u/proxy/builder/projects/${BUILDER_PROJECT_ID}/file?path=${ENCODED_PATH}")
      assert_http "file content: ${ONE_PATH}" "$RESP"
    else
      print_warn "No file path to test"
    fi
  else
    step "5.7" "File content — SKIPPED (no files)"
    print_skip "Files list was empty"
  fi

  # ─── 5.8 Download ZIP ─────────────────────────────────────────────────
  step "5.8" "Download ZIP — GET /u/proxy/builder/projects/:id/download"
  print_info "Streams the project as a ZIP file. Checks for PK signature."
  ZIP_OUT="/tmp/evium_dapp_${BUILDER_PROJECT_ID}.zip"
  curl -sS -b "$COOKIE_JAR" -o "$ZIP_OUT" "${BASE_URL}/u/proxy/builder/projects/${BUILDER_PROJECT_ID}/download" 2>/dev/null
  SIG=$(head -c 2 "$ZIP_OUT" 2>/dev/null)
  if [[ "$SIG" == $'PK' ]]; then
    print_pass "ZIP download (valid PK signature)"
  else
    print_warn "ZIP download: no PK signature (build may not be ready)"
  fi

  # ─── 5.9 GitHub export (optional) ─────────────────────────────────────
  step "5.9" "GitHub export — POST /u/proxy/builder/projects/:id/export/github"
  if [[ "$RUN_GITHUB_EXPORT" == "1" ]]; then
    print_info "Exports to GitHub. Body: {repo_name: '...'}"
    REPO_NAME="evium-e2e-${BUILDER_PROJECT_ID:0:8}-$(date +%s)"
    RESP=$(api_json POST "/u/proxy/builder/projects/${BUILDER_PROJECT_ID}/export/github" "{\"repo_name\":\"${REPO_NAME}\"}")
    assert_http "github export" "$RESP"
  else
    print_skip "Set RUN_GITHUB_EXPORT=1 to enable"
  fi

else
  step "5.3-5.9" "Builder detail/status/files/download — SKIPPED"
  print_skip "Builder project creation failed, skipping detail tests."
fi

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 6: DAPP INTEGRATION (NEW ENDPOINTS)                           ║
# ║  Tests the unified contract + frontend creation flow                    ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 6: DApp Integration (/u/proxy/builder/dapp/*)"

DAPP_PROJECT_ID=""

# ─── 6.1 Create DApp ─────────────────────────────────────────────────────────
step "6.1" "Create DApp — POST /u/proxy/builder/dapp/create"
print_info "Creates a full DApp: smart contract deployment + React frontend generation."
print_info "This is the PRIMARY endpoint for the new DApp flow."
print_info "Auth: cookie session + CSRF + pro_enabled entitlement."
print_info "Body: {prompt, network:'${NETWORK}', contract_only: false}"
print_info "Flow: user-api → Frontend_Builder /dapp/create → DAppOrchestrator"
print_info "  DAppOrchestrator → UserAPIClient → /u/service/ai/pipeline → EVI"
print_info "  DAppOrchestrator → WebBuilderService → LangGraph → Vercel"
print_info "Response: {ok, project: {id, fb_project_id, network, project_type:'dapp'}}"

DAPP_PROMPT="Create a simple voting DApp with a Solidity smart contract and React frontend"
RESP=$(api_json POST "/u/proxy/builder/dapp/create" \
  "{\"prompt\":\"${DAPP_PROMPT}\",\"network\":\"${NETWORK}\",\"contract_only\":false}")
CODE=$(get_http_code "$RESP")
BODY=$(get_body "$RESP")
if is_2xx "$CODE"; then
  print_pass "DApp create (HTTP $CODE)"
  DAPP_PROJECT_ID=$(echo "$BODY" | jq -r '.project.id // empty')
  DAPP_TYPE=$(echo "$BODY" | jq -r '.project.project_type // empty')
  if [[ -n "$DAPP_PROJECT_ID" && "$DAPP_PROJECT_ID" != "null" ]]; then
    print_pass "DApp project_id = ${DAPP_PROJECT_ID}"
    print_info "project_type = ${DAPP_TYPE}"
  else
    print_fail "No project.id in DApp create response"
    echo "$BODY" | jq . 2>/dev/null | head -15
  fi
else
  print_fail "DApp create (HTTP $CODE)"
  print_info "Response: $(echo "$BODY" | head -c 500)"
  print_info "If HTTP 403: check pro_enabled entitlement. If HTTP 502: check Frontend_Builder is running."
fi

# ─── 6.2 List DApps ──────────────────────────────────────────────────────────
step "6.2" "List DApps — GET /u/proxy/builder/projects?type=dapp"
print_info "Filters builder_projects to only show DApp-type projects."
print_info "Used by Ginie's Projects page DApps section."
RESP=$(api_json GET "/u/proxy/builder/projects?type=dapp&limit=20")
assert_http "list dapps" "$RESP"
DAPP_COUNT=$(get_body "$RESP" | jq -r '.projects | length' 2>/dev/null)
print_info "DApp projects: ${DAPP_COUNT}"

if [[ -n "$DAPP_PROJECT_ID" ]]; then
  FOUND=$(get_body "$RESP" | jq --arg id "$DAPP_PROJECT_ID" '[.projects[]?.id] | index($id) != null')
  if [[ "$FOUND" == "true" ]]; then
    print_pass "Created DApp found in filtered list"
  else
    print_warn "Created DApp NOT found in filtered list (possible delay)"
  fi
fi

# ─── 6.3 List all projects (unfiltered) confirms both types ──────────────────
step "6.3" "List all projects (unfiltered) — GET /u/proxy/builder/projects"
print_info "Should include both 'frontend' and 'dapp' type projects."
RESP=$(api_json GET "/u/proxy/builder/projects?limit=50")
assert_http "list all projects" "$RESP"
ALL_COUNT=$(get_body "$RESP" | jq -r '.projects | length' 2>/dev/null)
DAPP_IN_ALL=$(get_body "$RESP" | jq '[.projects[] | select(.project_type == "dapp")] | length' 2>/dev/null)
FRONTEND_IN_ALL=$(get_body "$RESP" | jq '[.projects[] | select(.project_type == "frontend")] | length' 2>/dev/null)
print_info "Total: ${ALL_COUNT}  |  DApps: ${DAPP_IN_ALL}  |  Frontends: ${FRONTEND_IN_ALL}"

# ─── 6.4 Get contracts for DApp ──────────────────────────────────────────────
if [[ -n "$DAPP_PROJECT_ID" ]]; then
  step "6.4" "Get contracts — GET /u/proxy/builder/projects/:id/contracts"
  print_info "Returns contract info for a DApp project."
  print_info "Tries upstream Frontend_Builder first, falls back to cached data."
  print_info "Now returns 200 with empty contracts[] if data isn't available yet (graceful)."
  RESP=$(api_json GET "/u/proxy/builder/projects/${DAPP_PROJECT_ID}/contracts")
  CODE=$(get_http_code "$RESP")
  BODY=$(get_body "$RESP")
  if is_2xx "$CODE"; then
    print_pass "get contracts (HTTP $CODE)"
    CONTRACTS_LEN=$(echo "$BODY" | jq -r '.contracts | length' 2>/dev/null)
    SOURCE=$(echo "$BODY" | jq -r '.source // "upstream"' 2>/dev/null)
    CACHED=$(echo "$BODY" | jq -r '.cached_contract.address // "none"' 2>/dev/null)
    print_info "Contracts: ${CONTRACTS_LEN}  |  Source: ${SOURCE}  |  Cached address: ${CACHED}"
    if [[ "$CONTRACTS_LEN" == "0" && "$SOURCE" == "none" ]]; then
      print_info "No contracts yet (DApp may still be building) — this is expected for a fresh DApp."
    fi
  else
    print_fail "get contracts (HTTP $CODE)"
    print_info "Response: $(echo "$BODY" | head -c 300)"
  fi
else
  step "6.4" "Get contracts — SKIPPED (no DApp project)"
  print_skip "DApp creation failed or skipped"
fi

# ─── 6.5 Create frontend for existing contract ───────────────────────────────
step "6.5" "Frontend for existing contract — POST /u/proxy/builder/dapp/frontend-for-contract"
print_info "Creates a React frontend for an ALREADY DEPLOYED contract."
print_info "Useful when user has a contract from another tool and wants a UI."
print_info "Body: {contract_address, abi: [...], network, prompt}"
# Use a dummy contract address for testing (endpoint will forward to Frontend_Builder)
DUMMY_ABI='[{"inputs":[],"name":"totalSupply","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"}]'
RESP=$(api_json POST "/u/proxy/builder/dapp/frontend-for-contract" \
  "{\"contract_address\":\"0x1234567890abcdef1234567890ABCDef12345678\",\"abi\":${DUMMY_ABI},\"network\":\"${NETWORK}\",\"prompt\":\"Create a simple UI to display totalSupply\"}")
CODE=$(get_http_code "$RESP")
if is_2xx "$CODE"; then
  print_pass "frontend-for-contract (HTTP $CODE)"
  FC_ID=$(get_body "$RESP" | jq -r '.project.id // empty')
  print_info "Frontend project_id = ${FC_ID}"
else
  print_warn "frontend-for-contract (HTTP $CODE) — Frontend_Builder may not be running"
  print_info "Response: $(get_body "$RESP" | head -c 300)"
fi

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 7: SERVICE-TO-SERVICE ENDPOINTS (/u/service/*)                 ║
# ║  These are used by Frontend_Builder's UserAPIClient to call user-api    ║
# ║  Auth: Bearer USERAPI_SERVICE_SECRET + X-User-Id header                 ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 7: Service-to-Service Endpoints (/u/service/*)"

if [[ -z "$USERAPI_SERVICE_SECRET" || "$USERAPI_SERVICE_SECRET" == "" ]]; then
  print_skip "USERAPI_SERVICE_SECRET not set — skipping service endpoint tests"
else
  SVC_USER_ID="${USER_ID:-test-user-id}"

  # ─── 7.1 Bad auth test ─────────────────────────────────────────────────
  step "7.1" "Service auth — bad token should 401"
  print_info "Tests that /u/service/* rejects requests with invalid Bearer token."
  RESP=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Bearer WRONG_TOKEN" \
    -H "X-User-Id: ${SVC_USER_ID}" \
    "${BASE_URL}/u/service/job/test-id/status")
  CODE=$(get_http_code "$RESP")
  if [[ "$CODE" == "401" ]]; then
    print_pass "Bad token correctly rejected (HTTP 401)"
  else
    print_fail "Bad token should return 401, got HTTP $CODE"
  fi

  # ─── 7.2 Missing X-User-Id test ────────────────────────────────────────
  step "7.2" "Service auth — missing X-User-Id should 400"
  RESP=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Bearer ${USERAPI_SERVICE_SECRET}" \
    "${BASE_URL}/u/service/job/test-id/status")
  CODE=$(get_http_code "$RESP")
  if [[ "$CODE" == "400" ]]; then
    print_pass "Missing X-User-Id correctly rejected (HTTP 400)"
  else
    print_fail "Missing X-User-Id should return 400, got HTTP $CODE"
  fi

  # ─── 7.3 Service pipeline create ────────────────────────────────────────
  SVC_JOB_ID=""
  if [[ "$SKIP_PIPELINE" != "1" ]]; then
    step "7.3" "Service pipeline — POST /u/service/ai/pipeline"
    print_info "Same as /u/proxy/ai/pipeline but uses Bearer token auth instead of cookies."
    print_info "This is what Frontend_Builder's UserAPIClient calls during DApp creation."
    print_info "Auth: Authorization: Bearer <USERAPI_SERVICE_SECRET> + X-User-Id: <user_id>"
    RESP=$(svc_json POST "/u/service/ai/pipeline" \
      "{\"prompt\":\"Create a simple storage contract\",\"network\":\"${NETWORK}\",\"maxIters\":3}" \
      "$SVC_USER_ID")
    CODE=$(get_http_code "$RESP")
    BODY=$(get_body "$RESP")
    if is_2xx "$CODE"; then
      print_pass "service pipeline create (HTTP $CODE)"
      SVC_JOB_ID=$(echo "$BODY" | jq -r '.job.id // .jobId // empty')
      print_info "job_id = ${SVC_JOB_ID}"
    else
      print_warn "service pipeline create (HTTP $CODE) — EVI upstream may be down"
      print_info "Response: $(echo "$BODY" | head -c 300)"
    fi
  else
    step "7.3" "Service pipeline — SKIPPED (SKIP_PIPELINE=1)"
    print_skip "Pipeline skipped"
  fi

  # ─── 7.4 Service job status ─────────────────────────────────────────────
  # Use JOB_ID from section 3 if SVC_JOB_ID is empty
  TEST_JOB_ID="${SVC_JOB_ID:-$JOB_ID}"
  if [[ -n "$TEST_JOB_ID" ]]; then
    step "7.4" "Service job status — GET /u/service/job/:id/status"
    print_info "Same as /u/proxy/job/:id/status but with service auth."
    RESP=$(svc_json GET "/u/service/job/${TEST_JOB_ID}/status?verbose=1" "" "$SVC_USER_ID")
    assert_http "service job status" "$RESP"

    # ─── 7.5 Service job detail ───────────────────────────────────────────
    step "7.5" "Service job detail — GET /u/service/job/:id"
    RESP=$(svc_json GET "/u/service/job/${TEST_JOB_ID}" "" "$SVC_USER_ID")
    assert_http "service job detail" "$RESP"

    # ─── 7.6 Service artifacts ────────────────────────────────────────────
    step "7.6" "Service artifacts — GET /u/service/artifacts?jobId=X"
    RESP=$(svc_json GET "/u/service/artifacts?jobId=${TEST_JOB_ID}&include=all" "" "$SVC_USER_ID")
    assert_http "service artifacts" "$RESP"

    step "7.6b" "Service artifact sources — GET /u/service/artifacts/sources"
    RESP=$(svc_json GET "/u/service/artifacts/sources?jobId=${TEST_JOB_ID}" "" "$SVC_USER_ID")
    assert_http "service artifact sources" "$RESP"

    step "7.6c" "Service artifact ABIs — GET /u/service/artifacts/abis"
    RESP=$(svc_json GET "/u/service/artifacts/abis?jobId=${TEST_JOB_ID}" "" "$SVC_USER_ID")
    assert_http "service artifact abis" "$RESP"

    # ─── 7.7 Service verify ──────────────────────────────────────────────
    step "7.7" "Service verify — POST /u/service/verify/byJob"
    print_info "Now includes network field (required by upstream EVI). Auto-resolves from user_jobs if omitted."
    RESP=$(svc_json POST "/u/service/verify/byJob" "{\"jobId\":\"${TEST_JOB_ID}\",\"network\":\"${NETWORK}\"}" "$SVC_USER_ID")
    CODE=$(get_http_code "$RESP")
    if is_2xx "$CODE"; then
      print_pass "service verify/byJob (HTTP $CODE)"
    else
      print_warn "service verify/byJob (HTTP $CODE) — upstream may not support verification for this network"
    fi

    # ─── 7.8 Service audit ───────────────────────────────────────────────
    step "7.8" "Service audit — POST /u/service/audit/byJob"
    RESP=$(svc_json POST "/u/service/audit/byJob" "{\"jobId\":\"${TEST_JOB_ID}\"}" "$SVC_USER_ID")
    CODE=$(get_http_code "$RESP")
    if is_2xx "$CODE"; then
      print_pass "service audit/byJob (HTTP $CODE)"
    else
      print_warn "service audit/byJob (HTTP $CODE)"
    fi

    # ─── 7.9 Service compliance ──────────────────────────────────────────
    step "7.9" "Service compliance — POST /u/service/compliance/byJob"
    RESP=$(svc_json POST "/u/service/compliance/byJob" "{\"jobId\":\"${TEST_JOB_ID}\"}" "$SVC_USER_ID")
    CODE=$(get_http_code "$RESP")
    if is_2xx "$CODE"; then
      print_pass "service compliance/byJob (HTTP $CODE)"
    else
      print_warn "service compliance/byJob (HTTP $CODE)"
    fi

    # ─── 7.10 Service SSE log stream ─────────────────────────────────────
    step "7.10" "Service log stream — GET /u/service/job/:id/logs/stream"
    print_info "SSE stream of job logs. Used by UserAPIClient for real-time monitoring."
    SVC_SSE_OUT="/tmp/evium_svc_sse_${TEST_JOB_ID}.txt"
    rm -f "$SVC_SSE_OUT"
    curl -sS -N --max-time 5 \
      -H "Authorization: Bearer ${USERAPI_SERVICE_SECRET}" \
      -H "X-User-Id: ${SVC_USER_ID}" \
      -H "Accept: text/event-stream" \
      "${BASE_URL}/u/service/job/${TEST_JOB_ID}/logs/stream" \
      >"$SVC_SSE_OUT" 2>/dev/null || true
    if [[ -s "$SVC_SSE_OUT" ]]; then
      print_pass "Service SSE stream returned data"
    else
      print_warn "Service SSE stream empty (job may have ended)"
    fi
  else
    step "7.4-7.10" "Service job endpoints — SKIPPED (no job_id)"
    print_skip "No pipeline job available for service endpoint tests"
  fi
fi

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 8: NEGATIVE TESTS (AUTH & VALIDATION)                         ║
# ║  Ensures endpoints properly reject bad requests                         ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 8: Negative Tests (Auth & Validation)"

# ─── 8.1 No cookie → 401 ─────────────────────────────────────────────────────
step "8.1" "No auth cookie → 401"
RESP=$(curl -sS -w "\n%{http_code}" "${BASE_URL}/u/user/me")
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "401" ]]; then
  print_pass "No cookie → HTTP 401 (correct)"
else
  print_fail "No cookie → HTTP $CODE (expected 401)"
fi

# ─── 8.2 Bad CSRF → 403 on write ─────────────────────────────────────────────
step "8.2" "Bad CSRF token → 403 on write"
RESP=$(curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' \
  -H 'x-csrf-token: INVALID_CSRF_TOKEN' \
  -d '{"display_name":"test"}' \
  "${BASE_URL}/u/user/profile")
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "403" ]]; then
  print_pass "Bad CSRF → HTTP 403 (correct)"
else
  print_fail "Bad CSRF → HTTP $CODE (expected 403)"
fi

# ─── 8.3 Invalid pipeline body → 400 ─────────────────────────────────────────
step "8.3" "Invalid pipeline body → 400"
RESP=$(api_json POST "/u/proxy/ai/pipeline" '{"prompt":"ab","network":"x"}')
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "400" ]]; then
  print_pass "Invalid pipeline body → HTTP 400 (correct)"
else
  print_warn "Invalid pipeline body → HTTP $CODE (expected 400)"
fi

# ─── 8.4 Invalid DApp create body → 400 ──────────────────────────────────────
step "8.4" "Invalid DApp create body → 400"
print_info "Prompt must be at least 4 chars. 'ab' should fail validation."
RESP=$(api_json POST "/u/proxy/builder/dapp/create" '{"prompt":"ab"}')
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "400" ]]; then
  print_pass "Invalid DApp body → HTTP 400 (correct)"
  print_info "Error: $(get_body "$RESP" | jq -r '.error.details[0].message // .error.code // empty' 2>/dev/null)"
else
  print_warn "Invalid DApp body → HTTP $CODE (expected 400)"
fi

step "8.4b" "Invalid contract address format → 400"
print_info "frontend-for-contract now validates 0x-prefixed 40-hex-char address."
RESP=$(api_json POST "/u/proxy/builder/dapp/frontend-for-contract" '{"contract_address":"not-an-address","abi":[],"network":"avalanche-fuji","prompt":"test"}')
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "400" ]]; then
  print_pass "Invalid contract address → HTTP 400 (correct)"
else
  print_warn "Invalid contract address → HTTP $CODE (expected 400)"
fi

# ─── 8.5 Non-existent project → 404 ──────────────────────────────────────────
step "8.5" "Non-existent project → 404"
print_info "Contracts endpoint now does dual lookup (DB id + fb_project_id). Both must fail for 404."
RESP=$(api_json GET "/u/proxy/builder/projects/00000000-0000-0000-0000-000000000000/contracts")
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "404" ]]; then
  print_pass "Non-existent project → HTTP 404 (correct)"
else
  print_warn "Non-existent project → HTTP $CODE (expected 404)"
fi

# ─── 8.6 Service endpoint without secret → 401 ───────────────────────────────
step "8.6" "Service endpoint without auth → 401"
RESP=$(curl -sS -w "\n%{http_code}" "${BASE_URL}/u/service/artifacts")
CODE=$(get_http_code "$RESP")
if [[ "$CODE" == "401" ]]; then
  print_pass "Service endpoint without auth → HTTP 401 (correct)"
else
  print_fail "Service endpoint without auth → HTTP $CODE (expected 401)"
fi

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  SECTION 9: CLEANUP                                                    ║
# ║  Delete test job (optional) and print summary                           ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
section "SECTION 9: Cleanup"

# ─── 9.1 Delete pipeline job (if created) ────────────────────────────────────
if [[ -n "$JOB_ID" ]]; then
  step "9.1" "Soft-delete job — DELETE /u/jobs/:jobId"
  print_info "Soft-deletes the test pipeline job. Can be undone."
  RESP=$(api_json DELETE "/u/jobs/${JOB_ID}")
  assert_http "delete job ${JOB_ID}" "$RESP"
else
  step "9.1" "Job cleanup — SKIPPED (no job)"
  print_skip "No pipeline job to delete"
fi

# Note: We do NOT logout here so the session can be reused for future runs
step "9.2" "Session preserved"
print_info "NOT logging out — session cookies preserved in ${COOKIE_JAR}"
print_info "Next run will reuse this session (no OTP needed)."
print_info "Set FORCE_LOGIN=1 to force a fresh login."

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  FINAL SUMMARY                                                         ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  TEST SUMMARY${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}Passed:${NC}  ${pass_count}"
echo -e "  ${RED}Failed:${NC}  ${fail_count}"
echo -e "  ${YELLOW}Warned:${NC}  ${warn_count}"
echo -e "  ${DIM}Skipped:${NC} ${skip_count}"
TOTAL=$((pass_count + fail_count + warn_count + skip_count))
echo -e "  ${BOLD}Total:${NC}   ${TOTAL}"
echo ""

if [[ "$fail_count" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}✓ ALL CHECKS PASSED${NC}"
  echo ""
  exit 0
else
  echo -e "  ${RED}${BOLD}✗ ${fail_count} CHECK(S) FAILED${NC}"
  echo ""
  exit 2
fi
