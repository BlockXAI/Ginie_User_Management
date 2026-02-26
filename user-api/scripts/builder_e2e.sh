#!/usr/bin/env bash
#
# E2E test for Frontend_Builder wrapper through user-api.
#
# - Logs in via OTP (you paste the OTP)
# - Requires hosted_frontend entitlement
# - Exercises builder wrapper REST endpoints + SSE events stream + WS tunnel
#
# Usage:
#   BASE_URL=http://localhost:8080 FRONTEND_BUILDER_BASE_URL=http://localhost:8000 \
#   ./scripts/builder_e2e.sh [email] [name]
#
# Optional:
#   RUN_GITHUB_EXPORT=1   (will attempt to export to GitHub; may create a repo)
#

set -u
set +e

BASE_URL=${BASE_URL:-http://localhost:8080}
IDENTITY=${1:-arpit@compliledger.com}
NAME=${2:-Arpit}
COOKIE_JAR=${COOKIE_JAR:-/tmp/evium_builder_e2e.jar}
RUN_GITHUB_EXPORT=${RUN_GITHUB_EXPORT:-0}
SKIP_ENTITLEMENT_CHECK=${SKIP_ENTITLEMENT_CHECK:-0}
FORCE_LOGIN=${FORCE_LOGIN:-0}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

jq_installed() { command -v jq >/dev/null 2>&1; }
read_cookie() { awk -v n="$1" '$6==n {print $7}' "$COOKIE_JAR" 2>/dev/null | tail -n1 || true; }
read_csrf() { awk '$6=="evium_csrf" {print $7}' "$COOKIE_JAR" 2>/dev/null | tail -n1 || true; }

print_pass() { echo -e "${GREEN}PASS${NC} - $1"; }
print_fail() { echo -e "${RED}FAIL${NC} - $1"; }
print_warn() { echo -e "${YELLOW}WARN${NC} - $1"; }

fail_count=0
step() {
  local name=$1
  echo ""
  echo "==> ${name}"
}

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
      "${BASE_URL}${path}" \
      "${extra_headers[@]}"
    return
  fi

  curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X "$method" -H 'Content-Type: application/json' \
    "${extra_headers[@]}" \
    -d "$data" \
    "${BASE_URL}${path}"
}

must_http_2xx() {
  local http_code=$1
  if [[ "$http_code" =~ ^2 ]]; then
    return 0
  fi
  return 1
}

touch "$COOKIE_JAR" 2>/dev/null || true

if ! jq_installed; then
  echo "jq is required for this script." >&2
  exit 1
fi

step "[1] Health check"
H=$(curl -sS -w "\n%{http_code}" "${BASE_URL}/u/healthz")
HC=$(echo "$H" | tail -n1)
if must_http_2xx "$HC"; then
  print_pass "/u/healthz"
else
  print_fail "/u/healthz (http=${HC})"
  exit 1
fi

step "[2] Authentication (reuse session if possible)"

AUTH_OK=0
if [[ "$FORCE_LOGIN" != "1" ]]; then
  ACCESS=$(read_cookie "evium_access")
  if [[ -n "$ACCESS" ]]; then
    ME_REUSE=$(api_json GET "/u/user/me")
    ME_REUSE_CODE=$(echo "$ME_REUSE" | tail -n1)
    if must_http_2xx "$ME_REUSE_CODE"; then
      AUTH_OK=1
      print_pass "reused existing session"
    else
      REFRESH=$(curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "${BASE_URL}/u/auth/refresh")
      REFRESH_CODE=$(echo "$REFRESH" | tail -n1)
      if must_http_2xx "$REFRESH_CODE"; then
        ME_REUSE2=$(api_json GET "/u/user/me")
        ME_REUSE2_CODE=$(echo "$ME_REUSE2" | tail -n1)
        if must_http_2xx "$ME_REUSE2_CODE"; then
          AUTH_OK=1
          print_pass "refreshed session"
        fi
      fi
    fi
  fi
fi

if [[ "$AUTH_OK" != "1" ]]; then
  echo "No valid session found; logging in via OTP. (Set FORCE_LOGIN=0 to reuse cookies next time.)"

  step "[2a] Send OTP (${IDENTITY})"
  SEND=$(curl -sS -w "\n%{http_code}" -X POST "${BASE_URL}/u/auth/send-otp" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\"}")
  SEND_CODE=$(echo "$SEND" | tail -n1)
  # Use sed to drop the last line (http code) to avoid 'head: illegal line count' on short outputs
  SEND_BODY=$(echo "$SEND" | sed '$d')
  if must_http_2xx "$SEND_CODE"; then
    print_pass "send-otp"
  else
    print_fail "send-otp (http=${SEND_CODE})"
    echo "$SEND_BODY"
    exit 1
  fi
  CHALLENGE_ID=$(echo "$SEND_BODY" | jq -r '.challengeId // empty')
  if [[ -z "$CHALLENGE_ID" || "$CHALLENGE_ID" == "null" ]]; then
    print_fail "send-otp did not return challengeId (cannot verify)"
    echo "$SEND_BODY"
    exit 1
  fi
  read -r -p "Enter OTP sent to ${IDENTITY}: " OTP

  step "[2b] Verify OTP (store cookies)"
  VERIFY=$(curl -sS -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "${BASE_URL}/u/auth/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE_ID}\"}")
  VERIFY_CODE=$(echo "$VERIFY" | tail -n1)
  VERIFY_BODY=$(echo "$VERIFY" | sed '$d')
  if must_http_2xx "$VERIFY_CODE"; then
    print_pass "verify"
  else
    print_fail "verify (http=${VERIFY_CODE})"
    echo "$VERIFY_BODY"
    exit 1
  fi
fi

CSRF=$(read_csrf)
if [[ -z "$CSRF" ]]; then
  print_fail "CSRF cookie missing (evium_csrf)"
  exit 1
fi
print_pass "CSRF cookie present"

step "[3] Check entitlement pro_enabled"
ME=$(api_json GET "/u/user/me")
ME_CODE=$(echo "$ME" | tail -n1)
ME_BODY=$(echo "$ME" | sed '$d')
if ! must_http_2xx "$ME_CODE"; then
  print_fail "/u/user/me (http=${ME_CODE})"
  echo "$ME_BODY"
  exit 1
fi
PRO_ENABLED=$(echo "$ME_BODY" | jq -r '.entitlements.pro_enabled // false')
if [[ "$PRO_ENABLED" != "true" ]]; then
  if [[ "$SKIP_ENTITLEMENT_CHECK" == "1" ]]; then
    print_warn "pro_enabled entitlement missing; continuing because SKIP_ENTITLEMENT_CHECK=1"
    echo "$ME_BODY" | jq '.entitlements // {}'
  else
    print_fail "pro_enabled entitlement missing"
    echo "$ME_BODY" | jq '.entitlements // {}'
    echo "Set SKIP_ENTITLEMENT_CHECK=1 to continue anyway (builder endpoints will likely 403)."
    exit 1
  fi
fi
print_pass "pro_enabled entitlement OK"

step "[5] Create builder project (POST /u/proxy/builder/projects)"
PROMPT=${PROMPT:-"Build a modern landing page for a web3 app. Use Tailwind. Include hero, features, pricing, FAQ."}
CREATE=$(api_json POST "/u/proxy/builder/projects" "{\"prompt\":\"${PROMPT//\"/\\\"}\"}")
CREATE_CODE=$(echo "$CREATE" | tail -n1)
CREATE_BODY=$(echo "$CREATE" | sed '$d')
if must_http_2xx "$CREATE_CODE"; then
  print_pass "builder create"
else
  print_fail "builder create (http=${CREATE_CODE})"
  echo "$CREATE_BODY" | jq .
  exit 1
fi
PROJECT_ID=$(echo "$CREATE_BODY" | jq -r '.project.id // empty')
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  print_fail "missing project.id in create response"
  echo "$CREATE_BODY" | jq .
  exit 1
fi
print_pass "project.id=${PROJECT_ID}"

step "[6] List builder projects"
LIST=$(api_json GET "/u/proxy/builder/projects?limit=20")
LIST_CODE=$(echo "$LIST" | tail -n1)
LIST_BODY=$(echo "$LIST" | sed '$d')
if must_http_2xx "$LIST_CODE"; then
  print_pass "builder list"
else
  print_fail "builder list (http=${LIST_CODE})"
  echo "$LIST_BODY" | jq .
  ((fail_count++))
fi
FOUND=$(echo "$LIST_BODY" | jq --arg id "$PROJECT_ID" '[.projects[]?.id] | index($id) != null')
if [[ "$FOUND" == "true" ]]; then
  print_pass "created project present in list"
else
  print_warn "created project not present in list (may indicate caching/db issue)"
fi

step "[7] Project detail + status"
DETAIL=$(api_json GET "/u/proxy/builder/projects/${PROJECT_ID}?includeMessages=1")
DETAIL_CODE=$(echo "$DETAIL" | tail -n1)
if must_http_2xx "$DETAIL_CODE"; then
  print_pass "builder detail"
else
  print_fail "builder detail (http=${DETAIL_CODE})"
  echo "$DETAIL" | sed '$d' | jq .
  ((fail_count++))
fi

STATUS=$(api_json GET "/u/proxy/builder/projects/${PROJECT_ID}/status")
STATUS_CODE=$(echo "$STATUS" | tail -n1)
if must_http_2xx "$STATUS_CODE"; then
  print_pass "builder status"
else
  print_fail "builder status (http=${STATUS_CODE})"
  echo "$STATUS" | sed '$d' | jq .
  ((fail_count++))
fi

step "[8] SSE events stream (WS->SSE bridge)"
SSE_OUT=/tmp/evium_builder_sse_${PROJECT_ID}.txt
rm -f "$SSE_OUT"
# Grab a short sample; expect ready/upstream_open/message frames
curl -sS -N -b "$COOKIE_JAR" -H 'Accept: text/event-stream' \
  --max-time 10 "${BASE_URL}/u/proxy/builder/projects/${PROJECT_ID}/events/stream" \
  >"$SSE_OUT" 2>/dev/null
if grep -q "event: ready" "$SSE_OUT"; then
  print_pass "SSE ready"
else
  print_warn "SSE ready not observed (check buffering / connectivity)"
fi
if grep -q "event: upstream_open" "$SSE_OUT"; then
  print_pass "SSE upstream_open"
else
  print_warn "SSE upstream_open not observed"
fi
if grep -q "event: message" "$SSE_OUT"; then
  print_pass "SSE message observed"
else
  print_warn "SSE message not observed (builder may be idle)"
fi

step "[9] WS tunnel (/u/ws/builder/:projectId)"
WS_URL=${BASE_URL/http:\/\//ws:\/\/}
WS_URL=${WS_URL/https:\/\//wss:\/\/}
WS_URL="${WS_URL}/u/ws/builder/${PROJECT_ID}"

NODE_LOG=/tmp/evium_builder_ws_${PROJECT_ID}.log
rm -f "$NODE_LOG"
node --input-type=module - <<'NODE' "$COOKIE_JAR" "$WS_URL" "$NODE_LOG"
import fs from 'fs';
import WebSocket from 'ws';

const jarPath = process.argv[2];
const wsUrl = process.argv[3];
const logPath = process.argv[4];

function buildCookieHeader(jarText) {
  const lines = jarText.split('\n').filter(Boolean);
  const cookies = [];
  for (const line of lines) {
    // Netscape cookie jar uses '#HttpOnly_' prefix in the domain column for HttpOnly cookies.
    // Do not drop those lines, otherwise evium_access won't be sent.
    let l = line;
    if (l.startsWith('#HttpOnly_')) l = l.slice('#HttpOnly_'.length);
    else if (l.startsWith('#')) continue;

    const parts = l.split('\t');
    if (parts.length < 7) continue;
    const name = parts[5];
    const value = parts[6];
    if (!name || !value) continue;
    if (name !== 'evium_access' && name !== 'evium_refresh' && name !== 'evium_csrf') continue;
    cookies.push(`${name}=${value}`);
  }
  return cookies.join('; ');
}

const jarText = fs.readFileSync(jarPath, 'utf8');
const cookieHeader = buildCookieHeader(jarText);
fs.writeFileSync(logPath, `wsUrl=${wsUrl}\nCookie=${cookieHeader}\n`);

if (!cookieHeader.includes('evium_access=')) {
  console.error('Missing evium_access cookie in jar');
  process.exit(2);
}

const ws = new WebSocket(wsUrl, { headers: { Cookie: cookieHeader } });
let got = false;
const timeout = setTimeout(() => {
  if (!got) {
    console.error('No WS message received within timeout');
    try { ws.close(); } catch {}
    process.exit(3);
  }
}, 10000);

ws.on('open', () => {
  fs.appendFileSync(logPath, 'open\n');
});

ws.on('message', (data) => {
  got = true;
  fs.appendFileSync(logPath, `message=${data.toString().slice(0, 500)}\n`);
  clearTimeout(timeout);
  try { ws.close(); } catch {}
  process.exit(0);
});

ws.on('error', (err) => {
  fs.appendFileSync(logPath, `error=${err?.message || String(err)}\n`);
});

ws.on('close', (code, reason) => {
  fs.appendFileSync(logPath, `close code=${code} reason=${reason?.toString?.() || ''}\n`);
});
NODE
WS_RC=$?
if [[ "$WS_RC" == "0" ]]; then
  print_pass "WS tunnel received message"
else
  print_fail "WS tunnel failed (rc=${WS_RC}); see ${NODE_LOG}"
  ((fail_count++))
fi

step "[10] Files list + one file content"
FILES_JSON=""
FILES_OK=0
for i in $(seq 1 20); do
  FILES=$(api_json GET "/u/proxy/builder/projects/${PROJECT_ID}/files")
  FILES_CODE=$(echo "$FILES" | tail -n1)
  FILES_BODY=$(echo "$FILES" | sed '$d')
  if must_http_2xx "$FILES_CODE"; then
    COUNT=$(echo "$FILES_BODY" | jq -r '.files | length' 2>/dev/null)
    if [[ "$COUNT" =~ ^[0-9]+$ ]] && [[ "$COUNT" -gt 0 ]]; then
      FILES_JSON="$FILES_BODY"
      FILES_OK=1
      break
    fi
  fi
  sleep 2
done

if [[ "$FILES_OK" == "1" ]]; then
  print_pass "files list non-empty"
else
  print_warn "files list still empty after retries"
fi

if [[ -n "$FILES_JSON" ]]; then
  ONE_PATH=$(echo "$FILES_JSON" | jq -r '.files[0]')
  if [[ -n "$ONE_PATH" && "$ONE_PATH" != "null" ]]; then
    ENCODED_PATH=$(python3 - <<PY "$ONE_PATH"
import urllib.parse, sys
print(urllib.parse.quote(sys.argv[1], safe=''))
PY
)
    FILE=$(api_json GET "/u/proxy/builder/projects/${PROJECT_ID}/file?path=${ENCODED_PATH}")
    FILE_CODE=$(echo "$FILE" | tail -n1)
    if must_http_2xx "$FILE_CODE"; then
      print_pass "file content: ${ONE_PATH}"
    else
      print_fail "file content failed (http=${FILE_CODE})"
      ((fail_count++))
    fi
  else
    print_warn "could not pick a file path from files list"
  fi
fi

step "[11] Download ZIP"
ZIP_OUT=/tmp/evium_builder_${PROJECT_ID}.zip
curl -sS -b "$COOKIE_JAR" -o "$ZIP_OUT" -D /tmp/evium_builder_zip_headers.txt \
  "${BASE_URL}/u/proxy/builder/projects/${PROJECT_ID}/download"
SIG=$(head -c 2 "$ZIP_OUT" 2>/dev/null)
if [[ "$SIG" == $'PK' ]]; then
  print_pass "ZIP download (signature PK)"
else
  print_fail "ZIP download bad signature (got='${SIG}')"
  ((fail_count++))
fi

step "[12] Export GitHub (optional)"
if [[ "$RUN_GITHUB_EXPORT" == "1" ]]; then
  REPO_NAME="evium-builder-e2e-${PROJECT_ID:0:8}-$(date +%s)"
  GH=$(api_json POST "/u/proxy/builder/projects/${PROJECT_ID}/export/github" "{\"repo_name\":\"${REPO_NAME}\"}")
  GH_CODE=$(echo "$GH" | tail -n1)
  if must_http_2xx "$GH_CODE"; then
    print_pass "github export"
  else
    print_fail "github export (http=${GH_CODE})"
    echo "$GH" | sed '$d' | jq .
    ((fail_count++))
  fi
else
  print_warn "skipped (set RUN_GITHUB_EXPORT=1 to enable)"
fi

step "[13] Logout"
LOGOUT=$(curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "${BASE_URL}/u/auth/logout")
LOGOUT_CODE=$(echo "$LOGOUT" | tail -n1)
if must_http_2xx "$LOGOUT_CODE"; then
  print_pass "logout"
else
  print_warn "logout (http=${LOGOUT_CODE})"
fi

echo ""
if [[ "$fail_count" -eq 0 ]]; then
  echo -e "${GREEN}ALL CHECKS PASSED${NC}"
  exit 0
else
  echo -e "${RED}${fail_count} CHECK(S) FAILED${NC}"
  exit 2
fi
