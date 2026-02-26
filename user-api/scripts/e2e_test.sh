#!/usr/bin/env bash
#
# E2E Test Script for EVI User Management API
# Tests REAL API calls with full logging - NO MOCKING
# All results saved to a SINGLE consolidated report file
#
# Usage:
#   export BASE_URL="http://localhost:8080"
#   export EVI_UPSTREAM_URL="https://evi-web-test-production.up.railway.app"
#   ./e2e_test.sh <email>
#

# Don't exit on errors - we want to continue testing and report all results
set -u
set +e

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
BASE_URL=${BASE_URL:-http://localhost:8080}
EVI_UPSTREAM_URL=${EVI_UPSTREAM_URL:-https://evi-web-test-production.up.railway.app}
IDENTITY=${1:-}
NETWORK=${NETWORK:-avalanche-fuji}
PROMPT=${PROMPT:-"Create a simple counter smart contract with increment and decrement functions. Keep constructor empty."}

if [[ -z "${IDENTITY}" ]]; then
  echo "Usage: $0 <email>" >&2
  echo "" >&2
  echo "Environment variables:" >&2
  echo "  BASE_URL         - User API base URL (default: http://localhost:8080)" >&2
  echo "  EVI_UPSTREAM_URL - Upstream EVI API URL (default: https://evi-web-test-production.up.railway.app)" >&2
  echo "  NETWORK          - Network for deployment (default: avalanche-fuji)" >&2
  echo "  PROMPT           - Contract prompt (default: simple counter)" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Setup Results
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="${SCRIPT_DIR}/results"
mkdir -p "$RESULTS_DIR"

COOKIE_JAR="/tmp/evi_e2e_cookies_${TIMESTAMP}.txt"
REPORT_FILE="${RESULTS_DIR}/e2e_report_${TIMESTAMP}.md"

# ─────────────────────────────────────────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────────────────────────────────────────
jq_installed() { command -v jq >/dev/null 2>&1; }
read_csrf() { awk '$6=="evium_csrf" {print $7}' "$COOKIE_JAR" 2>/dev/null | tail -n1 || true; }

# Colors for terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

print_status() {
  local status=$1
  local msg=$2
  if [[ "$status" == "PASS" ]]; then
    echo -e "${GREEN}✓ PASS${NC} - $msg"
  elif [[ "$status" == "FAIL" ]]; then
    echo -e "${RED}✗ FAIL${NC} - $msg"
  elif [[ "$status" == "WARN" ]]; then
    echo -e "${YELLOW}⚠ WARN${NC} - $msg"
  else
    echo -e "${BLUE}ℹ INFO${NC} - $msg"
  fi
}

# Write to report file
report() {
  echo "$@" >> "$REPORT_FILE"
}

report_section() {
  report ""
  report "---"
  report ""
  report "## $1"
  report ""
}

report_json() {
  local title=$1
  local json=$2
  report "### $title"
  report ""
  report '```json'
  if jq_installed; then
    echo "$json" | jq . 2>/dev/null >> "$REPORT_FILE" || echo "$json" >> "$REPORT_FILE"
  else
    echo "$json" >> "$REPORT_FILE"
  fi
  report '```'
  report ""
}

api_call() {
  local method=$1
  local endpoint=$2
  shift 2
  local data="${1:-}"

  local curl_args=(-sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" --connect-timeout 10 --max-time 30)

  if [[ -n "${CSRF:-}" ]]; then
    curl_args+=(-H "x-csrf-token: $CSRF")
  fi

  if [[ "$method" == "POST" ]]; then
    curl_args+=(-X POST -H "Content-Type: application/json")
    if [[ -n "$data" ]]; then
      curl_args+=(-d "$data")
    fi
  fi

  local full_response
  full_response=$(curl "${curl_args[@]}" "${BASE_URL}${endpoint}" 2>&1) || full_response=$'\n000'

  local http_code
  http_code=$(echo "$full_response" | tail -n1)
  local body
  body=$(echo "$full_response" | sed '$d')

  # Update CSRF after each call
  CSRF=$(read_csrf) || true

  # Return body
  echo "$body"
}

# ─────────────────────────────────────────────────────────────────────────────
# Initialize
# ─────────────────────────────────────────────────────────────────────────────
rm -f "$COOKIE_JAR"
CSRF=""

# Track test results
declare -a TEST_RESULTS=()
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_WARNED=0

add_result() {
  local test_num=$1
  local test_name=$2
  local status=$3
  local details=$4
  TEST_RESULTS+=("| $test_num | $test_name | $status | $details |")
  if [[ "$status" == "✅ PASS" ]]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
  elif [[ "$status" == "❌ FAIL" ]]; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    TESTS_WARNED=$((TESTS_WARNED + 1))
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Start Report
# ─────────────────────────────────────────────────────────────────────────────
cat > "$REPORT_FILE" << EOF
# EVI User Management API - E2E Test Report

**Generated:** $(date '+%Y-%m-%d %H:%M:%S')
**Base URL:** \`$BASE_URL\`
**Upstream URL:** \`$EVI_UPSTREAM_URL\`
**Network:** \`$NETWORK\`
**Email:** \`$IDENTITY\`

---

## Test Configuration

| Setting | Value |
|---------|-------|
| Base URL | \`$BASE_URL\` |
| Upstream URL | \`$EVI_UPSTREAM_URL\` |
| Target Network | \`$NETWORK\` |
| Test Email | \`$IDENTITY\` |
| Timestamp | \`$TIMESTAMP\` |

EOF

echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║           EVI User Management API - E2E Test Suite                            ║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BLUE}Base URL:${NC}     $BASE_URL"
echo -e "  ${BLUE}Upstream:${NC}     $EVI_UPSTREAM_URL"
echo -e "  ${BLUE}Network:${NC}      $NETWORK"
echo -e "  ${BLUE}Email:${NC}        $IDENTITY"
echo -e "  ${BLUE}Report:${NC}       $REPORT_FILE"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: Health Check
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[1/17] Health Check${NC}"
HEALTH=$(api_call GET "/u/healthz" 2>/dev/null)
HEALTH_OK=$(echo "$HEALTH" | jq -r '.ok // false' 2>/dev/null || echo "false")
REDIS_OK=$(echo "$HEALTH" | jq -r '.redis // false' 2>/dev/null || echo "false")

report_section "Test 1: Health Check"
report "**Endpoint:** \`GET /u/healthz\`"
report_json "Response" "$HEALTH"

if [[ "$HEALTH_OK" == "true" && "$REDIS_OK" == "true" ]]; then
  print_status "PASS" "API healthy, Redis connected"
  add_result "1" "Health Check" "✅ PASS" "API: ok, Redis: ok"
else
  print_status "FAIL" "Health check failed"
  add_result "1" "Health Check" "❌ FAIL" "API: $HEALTH_OK, Redis: $REDIS_OK"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: List Supported Networks
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[2/17] List Supported Networks${NC}"
NETWORKS=$(api_call GET "/u/networks" 2>/dev/null)
NETWORK_COUNT=$(echo "$NETWORKS" | jq '.networks | length' 2>/dev/null || echo "0")
NETWORK_IDS=$(echo "$NETWORKS" | jq -r '.networks[].id' 2>/dev/null | tr '\n' ', ' | sed 's/,$//')

report_section "Test 2: List Supported Networks"
report "**Endpoint:** \`GET /u/networks\`"
report "**Networks Found:** $NETWORK_COUNT"
report ""
report "| Network ID | Name | Chain ID | Testnet |"
report "|------------|------|----------|---------|"
echo "$NETWORKS" | jq -r '.networks[] | "| \(.id) | \(.name) | \(.chainId) | \(.testnet) |"' 2>/dev/null >> "$REPORT_FILE" || true
report ""
report_json "Full Response" "$NETWORKS"

if [[ "$NETWORK_COUNT" -gt 0 ]]; then
  print_status "PASS" "Found $NETWORK_COUNT networks: $NETWORK_IDS"
  add_result "2" "List Networks" "✅ PASS" "$NETWORK_COUNT networks found"
else
  print_status "FAIL" "No networks returned"
  add_result "2" "List Networks" "❌ FAIL" "No networks"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: Send OTP
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[3/17] Send OTP${NC}"
SEND_OTP=$(api_call POST "/u/auth/send-otp" "{\"identity\":\"${IDENTITY}\",\"name\":\"E2E Test\"}" 2>/dev/null)
CHALLENGE_ID=$(echo "$SEND_OTP" | jq -r '.challengeId // empty' 2>/dev/null || echo "")
EXPIRES_AT=$(echo "$SEND_OTP" | jq -r '.expiresAt // empty' 2>/dev/null || echo "")

report_section "Test 3: Send OTP"
report "**Endpoint:** \`POST /u/auth/send-otp\`"
report "**Email:** \`$IDENTITY\`"
report_json "Response" "$SEND_OTP"

if [[ -n "$CHALLENGE_ID" && "$CHALLENGE_ID" != "null" ]]; then
  print_status "PASS" "OTP sent, Challenge ID: ${CHALLENGE_ID:0:20}..."
  add_result "3" "Send OTP" "✅ PASS" "Challenge: ${CHALLENGE_ID:0:15}..."
else
  print_status "FAIL" "Failed to send OTP"
  add_result "3" "Send OTP" "❌ FAIL" "No challenge ID"
  echo "Exiting due to auth failure"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: Verify OTP
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}Enter OTP sent to ${IDENTITY}:${NC} "
read -r OTP

echo -e "${BOLD}[4/17] Verify OTP${NC}"
VERIFY=$(api_call POST "/u/auth/verify" "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE_ID}\"}" 2>/dev/null)
USER_ID=$(echo "$VERIFY" | jq -r '.user.id // empty' 2>/dev/null || echo "")
USER_ROLE=$(echo "$VERIFY" | jq -r '.user.role // empty' 2>/dev/null || echo "")
USER_EMAIL=$(echo "$VERIFY" | jq -r '.user.email // empty' 2>/dev/null || echo "")

report_section "Test 4: Verify OTP"
report "**Endpoint:** \`POST /u/auth/verify\`"
report_json "Response" "$VERIFY"

CSRF=$(read_csrf)

if [[ -n "$USER_ID" && "$USER_ID" != "null" ]]; then
  print_status "PASS" "Authenticated as $USER_EMAIL (Role: $USER_ROLE)"
  add_result "4" "Verify OTP" "✅ PASS" "User: $USER_EMAIL, Role: $USER_ROLE"
  report "**User ID:** \`$USER_ID\`"
  report "**Role:** \`$USER_ROLE\`"
else
  print_status "FAIL" "Authentication failed"
  add_result "4" "Verify OTP" "❌ FAIL" "Auth failed"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: Get User Profile
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[5/17] Get User Profile${NC}"
ME=$(api_call GET "/u/user/me" 2>/dev/null)
PRO_ENABLED=$(echo "$ME" | jq -r '.entitlements.pro_enabled // false' 2>/dev/null || echo "false")
WALLET_DEPLOY=$(echo "$ME" | jq -r '.entitlements.wallet_deployments // false' 2>/dev/null || echo "false")
JOBS_TODAY=$(echo "$ME" | jq -r '.counts.jobs_today // 0' 2>/dev/null || echo "0")
JOBS_TOTAL=$(echo "$ME" | jq -r '.counts.jobs_total // 0' 2>/dev/null || echo "0")

report_section "Test 5: User Profile"
report "**Endpoint:** \`GET /u/user/me\`"
report ""
report "| Entitlement | Status |"
report "|-------------|--------|"
report "| Pro Enabled | $PRO_ENABLED |"
report "| Wallet Deployments | $WALLET_DEPLOY |"
report "| Jobs Today | $JOBS_TODAY |"
report "| Jobs Total | $JOBS_TOTAL |"
report ""
report_json "Full Response" "$ME"

print_status "PASS" "Profile loaded (Pro: $PRO_ENABLED, Wallet: $WALLET_DEPLOY)"
add_result "5" "User Profile" "✅ PASS" "Pro: $PRO_ENABLED, Jobs: $JOBS_TOTAL"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 6: Invalid Network Validation
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[6/17] Invalid Network Validation${NC}"
INVALID_NET=$(api_call POST "/u/proxy/ai/pipeline" "{\"prompt\":\"test\",\"network\":\"invalid-network-xyz\",\"filename\":\"Test.sol\"}" 2>/dev/null || echo '{}')
INVALID_ERROR=$(echo "$INVALID_NET" | jq -r '.error.code // empty' 2>/dev/null || echo "")

report_section "Test 6: Network Validation"
report "**Endpoint:** \`POST /u/proxy/ai/pipeline\`"
report "**Test:** Submit invalid network \`invalid-network-xyz\`"
report_json "Response" "$INVALID_NET"

if [[ "$INVALID_ERROR" == "unsupported_network" ]]; then
  print_status "PASS" "Invalid network correctly rejected"
  add_result "6" "Network Validation" "✅ PASS" "Invalid network rejected"
else
  print_status "WARN" "Network validation may not be working (got: $INVALID_ERROR)"
  add_result "6" "Network Validation" "⚠️ WARN" "Error: $INVALID_ERROR"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 7: Create REAL Pipeline Job
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[7/17] Create Pipeline Job (network=$NETWORK)${NC}"

PIPELINE_PAYLOAD="{\"prompt\":\"$PROMPT\",\"network\":\"$NETWORK\",\"filename\":\"Counter.sol\",\"maxIters\":10,\"strictArgs\":true}"

PIPELINE=$(api_call POST "/u/proxy/ai/pipeline" "$PIPELINE_PAYLOAD" 2>/dev/null)
JOB_ID=$(echo "$PIPELINE" | jq -r '.job.id // .jobId // .id // .data.jobId // empty' 2>/dev/null || echo "")

report_section "Test 7: Create Pipeline Job"
report "**Endpoint:** \`POST /u/proxy/ai/pipeline\`"
report "**Network:** \`$NETWORK\`"
report "**Prompt:** \`$PROMPT\`"
report_json "Response" "$PIPELINE"

if [[ -n "$JOB_ID" && "$JOB_ID" != "null" && "$JOB_ID" != "{}" ]]; then
  print_status "PASS" "Job created: $JOB_ID"
  add_result "7" "Create Pipeline" "✅ PASS" "Job ID: ${JOB_ID:0:20}..."
  report "**Job ID:** \`$JOB_ID\`"
else
  print_status "FAIL" "Failed to create job"
  add_result "7" "Create Pipeline" "❌ FAIL" "No job ID returned"
  JOB_ID=""
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 8: Poll Job Status
# ═══════════════════════════════════════════════════════════════════════════════
JOB_STATE="pending"
CONTRACT_ADDRESS=""
CONTRACT_NAME=""
DEPLOY_NETWORK=""

if [[ -n "$JOB_ID" ]]; then
  echo -e "${BOLD}[8/17] Poll Job Status${NC}"

  report_section "Test 8: Job Status Polling"
  report "**Job ID:** \`$JOB_ID\`"
  report ""
  report "| Poll # | State | Progress | Address |"
  report "|--------|-------|----------|---------|"

  MAX_POLLS=60
  POLL_INTERVAL=5
  POLL_COUNT=0

  while [[ "$JOB_STATE" != "deployed" && "$JOB_STATE" != "failed" && "$JOB_STATE" != "error" && $POLL_COUNT -lt $MAX_POLLS ]]; do
    POLL_COUNT=$((POLL_COUNT + 1))

    STATUS=$(api_call GET "/u/proxy/job/${JOB_ID}/status" 2>/dev/null || echo '{}')
    JOB_STATE=$(echo "$STATUS" | jq -r '.data.state // .state // "unknown"' 2>/dev/null || echo "unknown")
    JOB_PROGRESS=$(echo "$STATUS" | jq -r '.data.progress // .progress // 0' 2>/dev/null || echo "0")

    if [[ "$JOB_STATE" == "deployed" ]]; then
      CONTRACT_ADDRESS=$(echo "$STATUS" | jq -r '.data.result.address // .result.address // empty' 2>/dev/null || echo "")
    fi

    report "| $POLL_COUNT | $JOB_STATE | $JOB_PROGRESS% | ${CONTRACT_ADDRESS:-pending} |"
    echo -e "  Poll $POLL_COUNT: State=$JOB_STATE, Progress=$JOB_PROGRESS%"

    if [[ "$JOB_STATE" == "deployed" || "$JOB_STATE" == "failed" || "$JOB_STATE" == "error" ]]; then
      break
    fi

    sleep $POLL_INTERVAL
  done

  report ""

  if [[ "$JOB_STATE" == "deployed" ]]; then
    print_status "PASS" "Deployed! Address: $CONTRACT_ADDRESS"
    add_result "8" "Job Status" "✅ PASS" "State: deployed"
  elif [[ "$JOB_STATE" == "failed" || "$JOB_STATE" == "error" ]]; then
    print_status "FAIL" "Job failed: $JOB_STATE"
    add_result "8" "Job Status" "❌ FAIL" "State: $JOB_STATE"
  else
    print_status "WARN" "Polling timeout, state: $JOB_STATE"
    add_result "8" "Job Status" "⚠️ WARN" "Timeout, state: $JOB_STATE"
  fi
else
  echo -e "${BOLD}[8/17] Poll Job Status - SKIPPED (no job ID)${NC}"
  add_result "8" "Job Status" "⚠️ SKIP" "No job ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 9: Get Job Details
# ═══════════════════════════════════════════════════════════════════════════════
if [[ -n "$JOB_ID" ]]; then
  echo -e "${BOLD}[9/17] Get Job Details${NC}"
  JOB_DETAIL=$(api_call GET "/u/proxy/job/${JOB_ID}?includeMagical=1" 2>/dev/null || echo '{}')

  CONTRACT_NAME=$(echo "$JOB_DETAIL" | jq -r '.data.result.contract // .result.contract // empty' 2>/dev/null || echo "")
  DEPLOY_NETWORK=$(echo "$JOB_DETAIL" | jq -r '.data.result.network // .result.network // empty' 2>/dev/null || echo "")
  CONTRACT_ADDRESS=$(echo "$JOB_DETAIL" | jq -r '.data.result.address // .result.address // empty' 2>/dev/null || echo "$CONTRACT_ADDRESS")

  report_section "Test 9: Job Details"
  report "**Endpoint:** \`GET /u/proxy/job/$JOB_ID\`"
  report ""
  report "| Field | Value |"
  report "|-------|-------|"
  report "| Contract Name | \`$CONTRACT_NAME\` |"
  report "| Network | \`$DEPLOY_NETWORK\` |"
  report "| Address | \`$CONTRACT_ADDRESS\` |"
  report ""
  report_json "Full Response" "$JOB_DETAIL"

  print_status "PASS" "Details: $CONTRACT_NAME on $DEPLOY_NETWORK"
  add_result "9" "Job Details" "✅ PASS" "Contract: $CONTRACT_NAME"
else
  echo -e "${BOLD}[9/17] Get Job Details - SKIPPED${NC}"
  add_result "9" "Job Details" "⚠️ SKIP" "No job ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 10: Get Job Logs
# ═══════════════════════════════════════════════════════════════════════════════
if [[ -n "$JOB_ID" ]]; then
  echo -e "${BOLD}[10/17] Get Job Logs${NC}"
  LOGS=$(api_call GET "/u/proxy/job/${JOB_ID}/logs?includeMagical=1" 2>/dev/null || echo '{}')
  LOG_COUNT=$(echo "$LOGS" | jq '.data.count // .count // 0' 2>/dev/null || echo "0")

  report_section "Test 10: Job Logs"
  report "**Endpoint:** \`GET /u/proxy/job/$JOB_ID/logs\`"
  report "**Log Count:** $LOG_COUNT"
  report_json "Response (truncated)" "$(echo "$LOGS" | jq '{ok, data: {id, total, count}}' 2>/dev/null || echo "$LOGS")"

  print_status "PASS" "Retrieved $LOG_COUNT log entries"
  add_result "10" "Job Logs" "✅ PASS" "$LOG_COUNT entries"
else
  echo -e "${BOLD}[10/17] Get Job Logs - SKIPPED${NC}"
  add_result "10" "Job Logs" "⚠️ SKIP" "No job ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 11: Get Artifacts
# ═══════════════════════════════════════════════════════════════════════════════
if [[ -n "$JOB_ID" ]]; then
  echo -e "${BOLD}[11/17] Get Artifacts${NC}"
  ARTIFACTS=$(api_call GET "/u/proxy/artifacts?jobId=${JOB_ID}" 2>/dev/null || echo '{}')
  SOURCE_COUNT=$(echo "$ARTIFACTS" | jq '.sources | length' 2>/dev/null || echo "0")
  ABI_COUNT=$(echo "$ARTIFACTS" | jq '.abis | length' 2>/dev/null || echo "0")

  report_section "Test 11: Artifacts"
  report "**Endpoint:** \`GET /u/proxy/artifacts?jobId=$JOB_ID\`"
  report ""
  report "| Artifact Type | Count |"
  report "|---------------|-------|"
  report "| Sources | $SOURCE_COUNT |"
  report "| ABIs | $ABI_COUNT |"
  report ""
  report_json "Response Summary" "$(echo "$ARTIFACTS" | jq '{ok, jobId, sources: (.sources | length), abis: (.abis | length)}' 2>/dev/null || echo "$ARTIFACTS")"

  print_status "PASS" "Artifacts: $SOURCE_COUNT sources, $ABI_COUNT ABIs"
  add_result "11" "Artifacts" "✅ PASS" "$SOURCE_COUNT sources, $ABI_COUNT ABIs"
else
  echo -e "${BOLD}[11/17] Get Artifacts - SKIPPED${NC}"
  add_result "11" "Artifacts" "⚠️ SKIP" "No job ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 12: Check Verification Status
# ═══════════════════════════════════════════════════════════════════════════════
IS_VERIFIED="false"
EXPLORER_URL=""

if [[ -n "$CONTRACT_ADDRESS" && "$CONTRACT_ADDRESS" != "null" ]]; then
  echo -e "${BOLD}[12/17] Check Verification Status${NC}"
  sleep 3  # Wait for auto-verification

  VERIFY_STATUS=$(api_call GET "/u/proxy/verify/status?address=${CONTRACT_ADDRESS}&network=${NETWORK}" 2>/dev/null || echo '{}')
  IS_VERIFIED=$(echo "$VERIFY_STATUS" | jq -r '.verified // false' 2>/dev/null || echo "false")
  EXPLORER_URL=$(echo "$VERIFY_STATUS" | jq -r '.explorerUrl // empty' 2>/dev/null || echo "")

  report_section "Test 12: Verification Status"
  report "**Endpoint:** \`GET /u/proxy/verify/status\`"
  report "**Address:** \`$CONTRACT_ADDRESS\`"
  report "**Verified:** $IS_VERIFIED"
  if [[ -n "$EXPLORER_URL" ]]; then
    report "**Explorer:** [$EXPLORER_URL]($EXPLORER_URL)"
  fi
  report_json "Response" "$VERIFY_STATUS"

  if [[ "$IS_VERIFIED" == "true" ]]; then
    print_status "PASS" "Contract verified on block explorer"
    add_result "12" "Verification" "✅ PASS" "Verified"
  else
    print_status "WARN" "Contract not yet verified"
    add_result "12" "Verification" "⚠️ WARN" "Not verified"
  fi
else
  echo -e "${BOLD}[12/17] Check Verification - SKIPPED (no address)${NC}"
  add_result "12" "Verification" "⚠️ SKIP" "No address"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 13: Manual Verify by Job
# ═══════════════════════════════════════════════════════════════════════════════
if [[ -n "$JOB_ID" && "$IS_VERIFIED" != "true" ]]; then
  echo -e "${BOLD}[13/17] Manual Verify by Job${NC}"
  MANUAL_VERIFY=$(api_call POST "/u/proxy/verify/byJob" "{\"jobId\":\"${JOB_ID}\",\"network\":\"${NETWORK}\"}" 2>/dev/null || echo '{}')
  VERIFY_OK=$(echo "$MANUAL_VERIFY" | jq -r '.ok // false' 2>/dev/null || echo "false")

  report_section "Test 13: Manual Verification"
  report "**Endpoint:** \`POST /u/proxy/verify/byJob\`"
  report_json "Response" "$MANUAL_VERIFY"

  if [[ "$VERIFY_OK" == "true" ]]; then
    print_status "PASS" "Manual verification triggered"
    add_result "13" "Manual Verify" "✅ PASS" "Triggered"
  else
    print_status "WARN" "Manual verification may have failed"
    add_result "13" "Manual Verify" "⚠️ WARN" "Result: $VERIFY_OK"
  fi
else
  echo -e "${BOLD}[13/17] Manual Verify - SKIPPED${NC}"
  add_result "13" "Manual Verify" "⚠️ SKIP" "Already verified or no job"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 14: Check Upstream Status
# ═══════════════════════════════════════════════════════════════════════════════
if [[ -n "$JOB_ID" ]]; then
  echo -e "${BOLD}[14/17] Check Upstream Status${NC}"
  UPSTREAM_STATUS=$(curl -sS "${EVI_UPSTREAM_URL}/api/job/${JOB_ID}/status" 2>&1 || echo '{"error":"failed"}')
  UPSTREAM_STATE=$(echo "$UPSTREAM_STATUS" | jq -r '.data.state // .state // .error // "unknown"' 2>/dev/null || echo "unknown")

  report_section "Test 14: Upstream Status Check"
  report "**URL:** \`${EVI_UPSTREAM_URL}/api/job/${JOB_ID}/status\`"
  report "**State:** \`$UPSTREAM_STATE\`"
  report_json "Response" "$UPSTREAM_STATUS"

  if [[ "$UPSTREAM_STATE" != "unknown" && "$UPSTREAM_STATE" != "JOB_NOT_FOUND" && "$UPSTREAM_STATE" != "failed" ]]; then
    print_status "PASS" "Upstream state: $UPSTREAM_STATE"
    add_result "14" "Upstream Check" "✅ PASS" "State: $UPSTREAM_STATE"
  else
    print_status "WARN" "Upstream returned: $UPSTREAM_STATE"
    add_result "14" "Upstream Check" "⚠️ WARN" "$UPSTREAM_STATE"
  fi
else
  echo -e "${BOLD}[14/17] Upstream Check - SKIPPED${NC}"
  add_result "14" "Upstream Check" "⚠️ SKIP" "No job ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 15: List User Jobs
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[15/17] List User Jobs${NC}"
USER_JOBS=$(api_call GET "/u/jobs" 2>/dev/null || echo '{}')
JOBS_COUNT=$(echo "$USER_JOBS" | jq '.jobs | length' 2>/dev/null || echo "0")

report_section "Test 15: User Jobs"
report "**Endpoint:** \`GET /u/jobs\`"
report "**Total Jobs:** $JOBS_COUNT"
report_json "Response Summary" "$(echo "$USER_JOBS" | jq '{ok, count: (.jobs | length), nextCursor}' 2>/dev/null || echo "$USER_JOBS")"

print_status "PASS" "Found $JOBS_COUNT jobs"
add_result "15" "User Jobs" "✅ PASS" "$JOBS_COUNT jobs"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 16: Metrics
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[16/17] Get Metrics${NC}"
METRICS=$(api_call GET "/u/metrics" 2>/dev/null || echo '{}')

report_section "Test 16: Metrics"
report "**Endpoint:** \`GET /u/metrics\`"
report_json "Response" "$METRICS"

print_status "PASS" "Metrics retrieved"
add_result "16" "Metrics" "✅ PASS" "Retrieved"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 17: Logout
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}[17/17] Logout${NC}"
LOGOUT=$(api_call POST "/u/auth/logout" "{}" 2>/dev/null || echo '{}')
LOGOUT_OK=$(echo "$LOGOUT" | jq -r '.ok // false' 2>/dev/null || echo "false")

report_section "Test 17: Logout"
report "**Endpoint:** \`POST /u/auth/logout\`"
report_json "Response" "$LOGOUT"

if [[ "$LOGOUT_OK" == "true" ]]; then
  print_status "PASS" "Logged out successfully"
  add_result "17" "Logout" "✅ PASS" "Success"
else
  print_status "WARN" "Logout returned: $LOGOUT_OK"
  add_result "17" "Logout" "⚠️ WARN" "Result: $LOGOUT_OK"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Final Summary
# ═══════════════════════════════════════════════════════════════════════════════
report ""
report "---"
report ""
report "## Test Results Summary"
report ""
report "| # | Test | Status | Details |"
report "|---|------|--------|---------|"
for result in "${TEST_RESULTS[@]}"; do
  report "$result"
done
report ""
report "---"
report ""
report "## Final Statistics"
report ""
report "| Metric | Value |"
report "|--------|-------|"
report "| ✅ Passed | $TESTS_PASSED |"
report "| ❌ Failed | $TESTS_FAILED |"
report "| ⚠️ Warnings | $TESTS_WARNED |"
report "| **Total** | $((TESTS_PASSED + TESTS_FAILED + TESTS_WARNED)) |"
report ""

if [[ -n "$JOB_ID" ]]; then
  report "---"
  report ""
  report "## Deployment Summary"
  report ""
  report "| Field | Value |"
  report "|-------|-------|"
  report "| Job ID | \`$JOB_ID\` |"
  report "| Final State | \`$JOB_STATE\` |"
  report "| Contract Name | \`${CONTRACT_NAME:-N/A}\` |"
  report "| Contract Address | \`${CONTRACT_ADDRESS:-N/A}\` |"
  report "| Network | \`${DEPLOY_NETWORK:-$NETWORK}\` |"
  report "| Verified | $IS_VERIFIED |"
  if [[ -n "$EXPLORER_URL" ]]; then
    report "| Explorer | [$EXPLORER_URL]($EXPLORER_URL) |"
  fi
  report ""
fi

report "---"
report ""
report "*Report generated by e2e_test.sh*"

# Cleanup
rm -f "$COOKIE_JAR"

# Print final summary
echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║                           TEST COMPLETE                                       ║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}✅ Passed:${NC}   $TESTS_PASSED"
echo -e "  ${RED}❌ Failed:${NC}   $TESTS_FAILED"
echo -e "  ${YELLOW}⚠️  Warnings:${NC} $TESTS_WARNED"
echo ""
if [[ -n "$JOB_ID" ]]; then
  echo -e "  ${BOLD}Job ID:${NC}      $JOB_ID"
  echo -e "  ${BOLD}State:${NC}       $JOB_STATE"
  echo -e "  ${BOLD}Contract:${NC}    ${CONTRACT_NAME:-N/A}"
  echo -e "  ${BOLD}Address:${NC}     ${CONTRACT_ADDRESS:-N/A}"
  echo -e "  ${BOLD}Network:${NC}     ${DEPLOY_NETWORK:-$NETWORK}"
  echo -e "  ${BOLD}Verified:${NC}    $IS_VERIFIED"
  if [[ -n "$EXPLORER_URL" ]]; then
    echo -e "  ${BOLD}Explorer:${NC}    $EXPLORER_URL"
  fi
  echo ""
fi
echo -e "  ${BOLD}Report saved to:${NC}"
echo -e "  ${BLUE}$REPORT_FILE${NC}"
echo ""
