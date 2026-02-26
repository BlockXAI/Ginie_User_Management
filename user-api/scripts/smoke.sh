#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:8080}
IDENTITY=${1:-}
NAME=${2:-User}
COOKIE_JAR=${COOKIE_JAR:-/tmp/evium_smoke.jar}
JOB_NETWORK=${JOB_NETWORK:-basecamp}
USE_WRAPPER=${USE_WRAPPER:-0}

if [[ -z "${IDENTITY}" ]]; then
  echo "Usage: $0 <email> [name]" >&2
  echo "ENV: BASE_URL (default http://localhost:8080)" >&2
  exit 1
fi

jq_installed() { command -v jq >/dev/null 2>&1; }
now_ms() { date +%s%3N; }
read_csrf() { awk '$6=="evium_csrf" {print $7}' "$COOKIE_JAR" | tail -n1 || true; }

rm -f "$COOKIE_JAR"

echo "[1/12] Health check..."
curl -sSf "$BASE_URL/u/healthz" | (jq_installed && jq . || cat)

echo "[2/12] Send OTP to ${IDENTITY}..."
SEND=$(curl -sSf -X POST "$BASE_URL/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\"}")
CHALLENGE=""
if jq_installed; then
  CHALLENGE=$(echo "$SEND" | jq -r '.challengeId // empty' 2>/dev/null || echo "")
fi
if [[ -z "$CHALLENGE" || "$CHALLENGE" == "null" ]]; then
  read -r -p "Enter challengeId (paste from response if shown; leave blank if not required): " CHALLENGE || true
fi
echo "$SEND" | (jq_installed && jq . || cat)

read -r -p "Enter OTP sent to ${IDENTITY}: " OTP

echo "[3/12] Verify OTP..."
VERIFY=$(curl -sSf -c "$COOKIE_JAR" -X POST "$BASE_URL/u/auth/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE}\"}")
echo "$VERIFY" | (jq_installed && jq . || cat)

CSRF=$(read_csrf)
if [[ -z "$CSRF" ]]; then
  echo "Failed to read CSRF cookie from jar" >&2
  exit 1
fi

JOB_ID="test_$(now_ms)_$RANDOM"

echo "[4/12] Attach job ${JOB_ID}..."
ATTACH=$(curl -sSf -b "$COOKIE_JAR" -X POST "$BASE_URL/u/jobs/attach" \
  -H "x-csrf-token: ${CSRF}" \
  -H 'Content-Type: application/json' \
  -d "{\"jobId\":\"${JOB_ID}\",\"type\":\"pipeline\",\"prompt\":\"Deploy ERC20\",\"filename\":\"MyToken.sol\",\"network\":\"sepolia\"}")
echo "$ATTACH" | (jq_installed && jq . || cat)

echo "[5/12] Upsert job cache..."
CACHE=$(curl -sSf -b "$COOKIE_JAR" -X POST "$BASE_URL/u/jobs/cache" \
  -H "x-csrf-token: ${CSRF}" \
  -H 'Content-Type: application/json' \
  -d "{\"jobId\":\"${JOB_ID}\",\"state\":\"running\",\"progress\":25}")
echo "$CACHE" | (jq_installed && jq . || cat)

sleep 1

echo "[6/12] List jobs..."
LIST=$(curl -sSf -b "$COOKIE_JAR" "$BASE_URL/u/jobs")
echo "$LIST" | (jq_installed && jq . || cat)

echo "[7/12] Get job by id..."
GET=$(curl -sSf -b "$COOKIE_JAR" "$BASE_URL/u/jobs/${JOB_ID}")
echo "$GET" | (jq_installed && jq . || cat)

echo "[8/12] Metrics..."
MET=$(curl -sSf "$BASE_URL/u/metrics")
echo "$MET" | (jq_installed && jq . || cat)

echo "[9/12] Me..."
ME=$(curl -sSf -b "$COOKIE_JAR" "$BASE_URL/u/user/me")
echo "$ME" | (jq_installed && jq . || cat)

# Refresh flow rotates access/refresh and CSRF
echo "[10/12] Refresh (rotate cookies)..."
REFRESH=$(curl -sSf -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/u/auth/refresh")
echo "$REFRESH" | (jq_installed && jq . || cat)
CSRF=$(read_csrf)
if [[ -z "$CSRF" ]]; then
  echo "Failed to read CSRF cookie from jar after refresh" >&2
  exit 1
fi

# Optional: wrapper route to create a job and auto-attach ownership
if [[ "$USE_WRAPPER" == "1" ]]; then
  echo "[11/12] Wrapper: create pipeline job (network=${JOB_NETWORK})..."
  WR=$(curl -sSf -b "$COOKIE_JAR" -X POST "$BASE_URL/u/proxy/ai/pipeline" \
    -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"Smoke Test Contract\",\"network\":\"${JOB_NETWORK}\",\"filename\":\"Smoke.sol\"}")
  echo "$WR" | (jq_installed && jq . || cat)
fi

echo "[12/12] Logout..."
LO=$(curl -sSf -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/u/auth/logout")
echo "$LO" | (jq_installed && jq . || cat)

echo "Done. JOB_ID=${JOB_ID}"
