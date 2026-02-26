#!/usr/bin/env bash
set -euo pipefail

# User API (auth + attach/cache) and Pipeline API (job create/status)
USER_API=${USER_API:-http://localhost:8080}
# Preferred variable for EVI pipeline endpoints
BASE_URL=${BASE_URL:-https://evi-v4-production.up.railway.app}
# Backward compatibility: allow PIPELINE_BASE to override BASE_URL if set
if [[ -n "${PIPELINE_BASE:-}" ]]; then BASE_URL="$PIPELINE_BASE"; fi
IDENTITY=${1:-}
NAME=${2:-User}
COOKIE_JAR=${COOKIE_JAR:-/tmp/evium_multi.jar}

if [[ -z "${IDENTITY}" ]]; then
  echo "Usage: $0 <email> [name]" >&2
  echo "ENV: USER_API (default http://localhost:8080)" >&2
  echo "ENV: BASE_URL (default https://evi-v4-production.up.railway.app)" >&2
  echo "ENV: PIPELINE_BASE (legacy; overrides BASE_URL if set)" >&2
  echo "ENV: USE_WRAPPER=1 to create jobs via USER_API/u/proxy/ai/pipeline (auth+CSRF)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "This script requires 'jq'. Please install it (brew install jq)" >&2
  exit 1
fi

now_ms() { date +%s%3N; }

# Clean cookies
rm -f "$COOKIE_JAR"

echo "[1/12] Health check (User API)..."
curl -sSf "$USER_API/u/healthz" | jq .

echo "[2/12] Send OTP to ${IDENTITY}..."
SEND=$(curl -sSf -X POST "$USER_API/u/auth/send-otp" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"name\":\"${NAME}\"}")
CHALLENGE=$(echo "$SEND" | jq -r '.challengeId // empty')
EXPIRES=$(echo "$SEND" | jq -r '.expiresAt // empty')
echo "$SEND" | jq .
if [[ -z "$CHALLENGE" || "$CHALLENGE" == "null" ]]; then
  read -r -p "Enter challengeId (paste from response if shown; leave blank if not required): " CHALLENGE || true
fi

read -r -p "Enter OTP sent to ${IDENTITY}: " OTP

echo "[3/12] Verify OTP..."
VERIFY=$(curl -sSf -c "$COOKIE_JAR" -X POST "$USER_API/u/auth/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"otp\":\"${OTP}\",\"challengeId\":\"${CHALLENGE}\"}")
echo "$VERIFY" | jq .

CSRF=$(awk '$6=="evium_csrf" {print $7}' "$COOKIE_JAR" | tail -n1 || true)
if [[ -z "$CSRF" ]]; then
  echo "Failed to read CSRF cookie from jar" >&2
  exit 1
fi

# Define multiple jobs (edit as needed)
JOBS='[
  {"prompt":"Create and deploy a TicTacToe smart contract for two players","network":"basecamp","filename":"TicTacToe.sol"},
  {"prompt":"Create and deploy a simple Counter contract with increment and get functions","network":"basecamp","filename":"Counter.sol"},
  {"prompt":"Create and deploy an ERC20 token named MultiCoin with symbol MTC and initial supply 1000000","network":"basecamp","filename":"MultiCoin.sol"}
]'

success=0
failed=0

echo "[4/12] Starting ${BASE_URL} pipelines for $(echo "$JOBS" | jq 'length') contracts..."

for i in $(seq 0 $(($(echo "$JOBS" | jq 'length')-1))); do
  item=$(echo "$JOBS" | jq -c ".[$i]")
  PROMPT=$(echo "$item" | jq -r '.prompt')
  NETWORK=$(echo "$item" | jq -r '.network')
  FILENAME=$(echo "$item" | jq -r '.filename')

  echo "[Job $((i+1))] Create pipeline: ${FILENAME} on ${NETWORK}"
  BODY=$(jq -nc --arg p "$PROMPT" --arg n "$NETWORK" --arg f "$FILENAME" '{prompt:$p, network:$n, maxIters:7, filename:$f, strictArgs:true}')
  if [[ "${USE_WRAPPER:-}" == "1" ]]; then
    RESP=$(curl -sS -b "$COOKIE_JAR" -X POST "$USER_API/u/proxy/ai/pipeline" \
      -H "x-csrf-token: ${CSRF}" -H 'Accept: application/json' -H 'Content-Type: application/json' \
      -d "$BODY")
  else
    RESP=$(curl -sS -X POST "$BASE_URL/api/ai/pipeline" \
      -H 'Accept: application/json' -H 'Content-Type: application/json' \
      -d "$BODY")
  fi
  echo "$RESP" | jq .
  JOB_ID=$(echo "$RESP" | jq -r '.job.id // empty')
  if [[ -z "$JOB_ID" || "$JOB_ID" == "null" ]]; then
    echo "  -> Failed to create job for ${FILENAME}" >&2
    failed=$((failed+1))
    continue
  fi

  echo "  -> Job ID: ${JOB_ID}. Polling status until completion..."
  attempts=0
  max_attempts=240  # up to ~12 minutes at 3s interval
  state=""
  address=""
  fqname=""
  endedAt=""
  while (( attempts < max_attempts )); do
    STATUS=$(curl -sS "$BASE_URL/api/job/$JOB_ID/status?verbose=1")
    state=$(echo "$STATUS" | jq -r '.data.state // empty')
    progress=$(echo "$STATUS" | jq -r '.data.progress // 0')
    address=$(echo "$STATUS" | jq -r '.data.result.address // empty')
    fqname=$(echo "$STATUS" | jq -r '.data.result.fqName // empty')
    endedAt=$(echo "$STATUS" | jq -r '.data.timings.endedAt // empty')
    printf "    state=%s progress=%s address=%s\n" "$state" "$progress" "${address:-}"

    if [[ "$state" == "completed" ]]; then
      if [[ -n "$address" && "$address" != "null" ]]; then
        echo "    -> Success: deployed at ${address}"
        # Save to backend ONLY on success
        echo "    -> Attach to user-api"
        curl -sS -b "$COOKIE_JAR" -X POST "$USER_API/u/jobs/attach" \
          -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
          -d "{\"jobId\":\"${JOB_ID}\",\"type\":\"pipeline\",\"prompt\":$(jq -Rs <<<"$PROMPT"),\"filename\":\"${FILENAME}\",\"network\":\"${NETWORK}\"}" | jq .

        echo "    -> Upsert job cache"
        # completed_at is epoch ms; pass as number so server coerce to Date
        curl -sS -b "$COOKIE_JAR" -X POST "$USER_API/u/jobs/cache" \
          -H "x-csrf-token: ${CSRF}" -H 'Content-Type: application/json' \
          -d "{\"jobId\":\"${JOB_ID}\",\"state\":\"completed\",\"progress\":100,\"address\":\"${address}\",\"fq_name\":\"${fqname}\",\"constructor_args\":[],\"verified\":false,\"completed_at\":${endedAt:-0}}" | jq .

        success=$((success+1))
      else
        echo "    -> Completed without address. Not saving to backend."
        failed=$((failed+1))
      fi
      break
    fi

    if [[ "$state" == "failed" || "$state" == "error" ]]; then
      echo "    -> Job ended with state=${state}. Not saving to backend."
      failed=$((failed+1))
      break
    fi

    attempts=$((attempts+1))
    sleep 3
  done

  if (( attempts >= max_attempts )); then
    echo "    -> Timed out waiting for completion. Not saving to backend."
    failed=$((failed+1))
  fi

echo ""
done

echo "[5/12] List user jobs from backend..."
curl -sS -b "$COOKIE_JAR" "$USER_API/u/jobs" | jq .

echo "[6/12] Metrics..."
curl -sS "$USER_API/u/metrics" | jq .

echo "[7/12] Me..."
curl -sS -b "$COOKIE_JAR" "$USER_API/u/user/me" | jq .

echo "[8/12] Logout..."
curl -sS -b "$COOKIE_JAR" -X POST "$USER_API/u/auth/logout" | jq .

echo "Summary: success=${success}, failed=${failed}"
