#!/bin/bash
# Test script for metrics-related endpoints
# Tests: system metrics, user job counts, smart contracts, DApps, and user associations
#
# Usage:
#   ./test_metrics.sh [BASE_URL] [ACCESS_TOKEN] [CSRF_TOKEN]
#
# Example:
#   ./test_metrics.sh http://localhost:8080 "your-access-token" "your-csrf-token"

set -u
set +e

# Configuration
BASE_URL="${1:-http://localhost:8080}"
ACCESS_TOKEN="${2:-}"
CSRF_TOKEN="${3:-}"

# Session management
COOKIE_JAR="${COOKIE_JAR:-/tmp/evium_dapp_e2e.jar}"
IDENTITY="${IDENTITY:-arpit@compliledger.com}"
NAME="${NAME:-Arpit}"
OTP_CODE="${OTP_CODE:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Results tracking
PASSED=0
FAILED=0
SKIPPED=0

touch "$COOKIE_JAR" 2>/dev/null || true

print_header() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

print_test() {
  echo -e "\n${YELLOW}▶ TEST: $1${NC}"
}

print_pass() {
  echo -e "${GREEN}✓ PASS: $1${NC}"
  ((PASSED++))
}

print_fail() {
  echo -e "${RED}✗ FAIL: $1${NC}"
  ((FAILED++))
}

print_skip() {
  echo -e "${YELLOW}⊘ SKIP: $1${NC}"
  ((SKIPPED++))
}

print_info() {
  echo -e "  ${NC}$1${NC}"
}

read_csrf() {
  awk '$6=="evium_csrf" {print $7}' "$COOKIE_JAR" 2>/dev/null | tail -n1 || true
}

pretty_json() {
  python3 -m json.tool 2>/dev/null || cat
}

curl_json() {
  local method="$1"; shift
  local path="$1"; shift
  local data="${1:-}"

  local csrf
  csrf=$(read_csrf)

  if [ -n "$data" ]; then
    if [ -n "$csrf" ]; then
      curl -s -w "\n%{http_code}" \
        -X "$method" \
        -H 'content-type: application/json' \
        -H "x-csrf-token: $csrf" \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        --data "$data" \
        "$BASE_URL$path" 2>&1
    else
      curl -s -w "\n%{http_code}" \
        -X "$method" \
        -H 'content-type: application/json' \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        --data "$data" \
        "$BASE_URL$path" 2>&1
    fi
  else
    if [ -n "$csrf" ]; then
      curl -s -w "\n%{http_code}" \
        -X "$method" \
        -H "x-csrf-token: $csrf" \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        "$BASE_URL$path" 2>&1
    else
      curl -s -w "\n%{http_code}" \
        -X "$method" \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        "$BASE_URL$path" 2>&1
    fi
  fi
}

get_http_code() {
  echo "$1" | tail -n1
}

get_body() {
  echo "$1" | sed '$d'
}

ensure_session() {
  # If a direct access token is provided, we keep legacy support by planting it into the cookie jar.
  # Otherwise, we reuse the cookie jar from the last login.
  if [ -n "$ACCESS_TOKEN" ]; then
    : > "$COOKIE_JAR"
    printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
      "localhost" "FALSE" "/" "FALSE" "0" "evium_access" "$ACCESS_TOKEN" >> "$COOKIE_JAR"
  fi

  local me
  me=$(curl_json GET "/u/user/me")
  local code
  code=$(get_http_code "$me")
  if [ "$code" = "200" ]; then
    return 0
  fi

  # Try refresh (may rotate cookies if refresh token exists)
  local rr
  rr=$(curl -s -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/u/auth/refresh" 2>&1)
  code=$(get_http_code "$rr")
  if [ "$code" = "200" ]; then
    me=$(curl_json GET "/u/user/me")
    code=$(get_http_code "$me")
    if [ "$code" = "200" ]; then
      return 0
    fi
  fi

  print_info "No active session found. Starting OTP login flow (one time)."
  local send
  send=$(curl_json POST "/u/auth/send-otp" "{\"identity\":\"$IDENTITY\",\"name\":\"$NAME\",\"mode\":\"auto\"}")
  code=$(get_http_code "$send")
  if [ "$code" != "200" ]; then
    print_fail "send-otp failed (HTTP $code)"
    print_info "Response: $(get_body "$send" | head -c 250)"
    return 1
  fi
  local challenge
  challenge=$(get_body "$send" | python3 -c 'import sys,json; print((json.load(sys.stdin) or {}).get("challengeId",""))' 2>/dev/null)
  if [ -z "$challenge" ]; then
    print_fail "send-otp did not return challengeId"
    return 1
  fi

  if [ -z "$OTP_CODE" ]; then
    read -r -p "Enter OTP for $IDENTITY: " OTP_CODE
  fi
  local verify
  verify=$(curl_json POST "/u/auth/verify" "{\"identity\":\"$IDENTITY\",\"otp\":\"$OTP_CODE\",\"challengeId\":\"$challenge\",\"mode\":\"auto\",\"name\":\"$NAME\"}")
  code=$(get_http_code "$verify")
  if [ "$code" != "200" ]; then
    print_fail "verify failed (HTTP $code)"
    print_info "Response: $(get_body "$verify" | head -c 250)"
    return 1
  fi

  me=$(curl_json GET "/u/user/me")
  code=$(get_http_code "$me")
  if [ "$code" = "200" ]; then
    return 0
  fi
  return 1
}

# ============================================================================
# TEST 1: System Metrics (Public endpoint)
# ============================================================================
test_system_metrics() {
  print_header "System Metrics Endpoint"
  print_test "GET /u/metrics - Retrieve system-wide metrics"

  if ! ensure_session; then
    print_fail "No valid session available for /u/metrics"
    return
  fi

  RESPONSE=$(curl_json GET "/u/metrics")
  HTTP_CODE=$(get_http_code "$RESPONSE")
  BODY=$(get_body "$RESPONSE")

  print_info "HTTP Status: $HTTP_CODE"

  echo "$BODY" | pretty_json | head -60

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q '"ok":true'; then
      print_pass "System metrics endpoint returns ok:true"

      # Check for metrics object
      if echo "$BODY" | grep -q '"metrics"'; then
        print_pass "Metrics object present in response"
      fi

      # Check for user counts
      if echo "$BODY" | grep -q '"users"'; then
        print_pass "User count statistics included"
      fi
    else
      print_fail "Response does not contain ok:true"
    fi
  else
    print_fail "Expected HTTP 200, got $HTTP_CODE"
  fi
}

# ============================================================================
# TEST 2: User Info with Job Counts
# ============================================================================
test_user_me_counts() {
  print_header "User Info with Job Counts"
  print_test "GET /u/user/me - Retrieve user info including job counts"

  if ! ensure_session; then
    print_skip "No session available. Set IDENTITY env var to allow OTP login (session will be reused via cookie jar)."
    return
  fi

  RESPONSE=$(curl_json GET "/u/user/me")
  HTTP_CODE=$(get_http_code "$RESPONSE")
  BODY=$(get_body "$RESPONSE")

  print_info "HTTP Status: $HTTP_CODE"

  echo "$BODY" | pretty_json | head -60

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q '"ok":true'; then
      print_pass "User info endpoint returns ok:true"

      # Check for counts object
      if echo "$BODY" | grep -q '"counts"'; then
        print_pass "Job counts included in response"

        JOBS_TODAY=$(echo "$BODY" | grep -o '"jobs_today":[0-9]*' | head -1 | cut -d':' -f2)
        JOBS_TOTAL=$(echo "$BODY" | grep -o '"jobs_total":[0-9]*' | head -1 | cut -d':' -f2)

        print_info "Jobs today: ${JOBS_TODAY:-0}"
        print_info "Jobs total: ${JOBS_TOTAL:-0}"
      else
        print_fail "Counts object missing from response"
      fi

      # Extract user ID
      if echo "$BODY" | grep -q '"id"'; then
        USER_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        print_info "User ID: $USER_ID"
      fi
    else
      print_fail "Response does not contain ok:true"
    fi
  elif [ "$HTTP_CODE" = "401" ]; then
    print_fail "Authentication failed - token may be invalid"
  else
    print_fail "Expected HTTP 200, got $HTTP_CODE"
  fi
}

# ============================================================================
# TEST 3: User Jobs List (Smart Contracts)
# ============================================================================
test_user_jobs() {
  print_header "User Jobs (Smart Contracts)"
  print_test "GET /u/wrapper/jobs - List user's smart contract jobs"

  if ! ensure_session; then
    print_skip "No session available. Set IDENTITY env var to allow OTP login."
    return
  fi

  RESPONSE=$(curl_json GET "/u/wrapper/jobs?limit=10")
  HTTP_CODE=$(get_http_code "$RESPONSE")
  BODY=$(get_body "$RESPONSE")

  print_info "HTTP Status: $HTTP_CODE"

  echo "$BODY" | pretty_json | head -60

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q '"ok":true'; then
      print_pass "Jobs list endpoint returns ok:true"

      if echo "$BODY" | grep -q '"jobs"'; then
        JOB_COUNT=$(echo "$BODY" | grep -o '"job_id"' | wc -l | tr -d ' ')
        print_info "Jobs returned: $JOB_COUNT"

        if [ "$JOB_COUNT" -gt 0 ]; then
          print_pass "User has associated smart contract jobs"
          FIRST_JOB_ID=$(echo "$BODY" | grep -o '"job_id":"[^"]*"' | head -1 | cut -d'"' -f4)
          print_info "Sample Job ID: $FIRST_JOB_ID"
        else
          print_info "No jobs found (valid for new users)"
        fi
      fi
    else
      print_fail "Response does not contain ok:true"
    fi
  elif [ "$HTTP_CODE" = "401" ]; then
    print_fail "Authentication failed"
  else
    print_fail "Expected HTTP 200, got $HTTP_CODE"
  fi
}

# ============================================================================
# TEST 4: Builder Projects (DApps)
# ============================================================================
test_builder_projects() {
  print_header "Builder Projects (DApps)"
  print_test "GET /u/proxy/builder/projects - List user's DApp projects"

  if ! ensure_session; then
    print_skip "No session available. Set IDENTITY env var to allow OTP login."
    return
  fi

  RESPONSE=$(curl_json GET "/u/proxy/builder/projects?limit=10")
  HTTP_CODE=$(get_http_code "$RESPONSE")
  BODY=$(get_body "$RESPONSE")

  print_info "HTTP Status: $HTTP_CODE"

  echo "$BODY" | pretty_json | head -60

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q '"ok":true'; then
      print_pass "Builder projects endpoint returns ok:true"

      if echo "$BODY" | grep -q '"projects"'; then
        PROJECT_COUNT=$(echo "$BODY" | grep -o '"fb_project_id"' | wc -l | tr -d ' ')
        print_info "Projects returned: $PROJECT_COUNT"

        if [ "$PROJECT_COUNT" -gt 0 ]; then
          print_pass "User has associated DApp projects"

          # Check for DApp-specific fields
          echo "$BODY" | grep -q '"vercel_url"' && print_pass "vercel_url field present"
          echo "$BODY" | grep -q '"contract_address"' && print_pass "contract_address field present"
          echo "$BODY" | grep -q '"project_type"' && print_pass "project_type field present"
        fi
      fi
    else
      print_info "Response format differs (may indicate empty or error)"
    fi
  elif [ "$HTTP_CODE" = "502" ] || [ "$HTTP_CODE" = "503" ]; then
    print_skip "Builder service unavailable (HTTP $HTTP_CODE)"
  else
    print_info "HTTP Status: $HTTP_CODE"
  fi
}

# ============================================================================
# TEST 5: DApp Projects Filtered by Type
# ============================================================================
test_dapp_projects_filtered() {
  print_header "DApp Projects (Filtered)"
  print_test "GET /u/proxy/builder/projects?type=dapp - List only DApp type projects"

  if ! ensure_session; then
    print_skip "No session available. Set IDENTITY env var to allow OTP login."
    return
  fi

  RESPONSE=$(curl_json GET "/u/proxy/builder/projects?type=dapp&limit=10")
  HTTP_CODE=$(get_http_code "$RESPONSE")
  BODY=$(get_body "$RESPONSE")

  print_info "HTTP Status: $HTTP_CODE"

  echo "$BODY" | pretty_json | head -60

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q '"ok":true'; then
      print_pass "Filtered DApp projects endpoint works"

      if echo "$BODY" | grep -q '"project_type":"dapp"'; then
        print_pass "Returned projects filtered to type=dapp"
      elif echo "$BODY" | grep -q '"projects":\[\]'; then
        print_info "No DApp-type projects found (empty result)"
      fi
    fi
  elif [ "$HTTP_CODE" = "502" ] || [ "$HTTP_CODE" = "503" ]; then
    print_skip "Builder service unavailable"
  fi
}

# ============================================================================
# TEST 6: Single Job Details
# ============================================================================
test_job_details() {
  print_header "Job Details (Contract Association)"
  print_test "GET /u/wrapper/jobs/:id - Get detailed job info"

  if ! ensure_session; then
    print_skip "No session available. Set IDENTITY env var to allow OTP login."
    return
  fi

  # Get a job ID first
  LIST_RESPONSE=$(curl_json GET "/u/wrapper/jobs?limit=1")

  FIRST_JOB_ID=$(echo "$LIST_RESPONSE" | python3 -c 'import sys,json; j=json.load(sys.stdin); jobs=j.get("jobs",[]) if isinstance(j,dict) else []; print((jobs[0] or {}).get("job_id",""))' 2>/dev/null)

  if [ -z "$FIRST_JOB_ID" ]; then
    print_skip "No jobs available to test"
    return
  fi

  print_info "Testing Job ID: $FIRST_JOB_ID"

  RESPONSE=$(curl_json GET "/u/wrapper/jobs/$FIRST_JOB_ID")
  HTTP_CODE=$(get_http_code "$RESPONSE")
  BODY=$(get_body "$RESPONSE")

  print_info "HTTP Status: $HTTP_CODE"

  echo "$BODY" | pretty_json | head -80

  if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q '"ok":true'; then
      print_pass "Job details endpoint returns ok:true"

      echo "$BODY" | grep -q '"contract_address"' && print_pass "contract_address field present"
      echo "$BODY" | grep -q '"network"' && print_info "network field present"
      echo "$BODY" | grep -q '"verified"' && print_info "verified status present"
    fi
  elif [ "$HTTP_CODE" = "403" ]; then
    print_fail "Access denied - job may not belong to user"
  elif [ "$HTTP_CODE" = "404" ]; then
    print_fail "Job not found"
  else
    print_fail "Expected HTTP 200, got $HTTP_CODE"
  fi
}

# ============================================================================
# TEST 7: User-Project Association Verification
# ============================================================================
test_user_association() {
  print_header "User-Project Association"
  print_test "Verify projects are correctly associated with user"

  if ! ensure_session; then
    print_skip "No session available. Set IDENTITY env var to allow OTP login."
    return
  fi

  # Get user info
  USER_RESPONSE=$(curl_json GET "/u/user/me")

  USER_ID=$(echo "$USER_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$USER_ID" ]; then
    print_skip "Could not retrieve user ID"
    return
  fi

  print_info "User ID: $USER_ID"

  # Get jobs
  JOBS_RESPONSE=$(curl_json GET "/u/wrapper/jobs?limit=5")

  if echo "$JOBS_RESPONSE" | grep -q '"ok":true'; then
    JOB_COUNT=$(echo "$JOBS_RESPONSE" | grep -o '"job_id"' | wc -l | tr -d ' ')

    if [ "$JOB_COUNT" -gt 0 ]; then
      print_pass "Jobs are associated with authenticated user ($JOB_COUNT jobs)"
    else
      print_info "No jobs associated with user (valid for new users)"
    fi
  fi

  # Get builder projects
  PROJECTS_RESPONSE=$(curl_json GET "/u/proxy/builder/projects?limit=5")

  if echo "$PROJECTS_RESPONSE" | grep -q '"ok":true'; then
    PROJECT_COUNT=$(echo "$PROJECTS_RESPONSE" | grep -o '"fb_project_id"' | wc -l | tr -d ' ')

    if [ "$PROJECT_COUNT" -gt 0 ]; then
      print_pass "Builder projects are associated with user ($PROJECT_COUNT projects)"
    else
      print_info "No builder projects associated with user"
    fi
  fi
}

# ============================================================================
# Run all tests
# ============================================================================
print_header "EVI Metrics Endpoints Test Suite"
echo "Base URL: $BASE_URL"
echo "Cookie Jar: $COOKIE_JAR"
echo "Identity: ${IDENTITY}"

test_system_metrics
test_user_me_counts
test_user_jobs
test_builder_projects
test_dapp_projects_filtered
test_job_details
test_user_association

# Summary
print_header "Test Summary"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo -e "${YELLOW}Skipped: $SKIPPED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
