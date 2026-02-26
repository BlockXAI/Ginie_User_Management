#!/usr/bin/env bash
set -euo pipefail

# Phase 1 negative tests:
# - invalid key
# - revoked key
# - expired key
# - missing CSRF on POST
# - non-admin hitting admin endpoints
# - refresh flow simulated 401 -> refresh -> retry (basic check)
# Usage:
#   BASE_URL=http://localhost:8080 bash scripts/phase1_negative.sh <admin_email> <user_email> [admin_name] [user_name]

BASE_URL=${BASE_URL:-http://localhost:8080}
ADMIN_EMAIL=${1:-}
USER_EMAIL=${2:-}
ADMIN_NAME=${3:-Admin}
USER_NAME=${4:-User}
ADMIN_JAR=${ADMIN_JAR:-/tmp/evium_admin_neg.jar}
USER_JAR=${USER_JAR:-/tmp/evium_user_neg.jar}

if [[ -z "$ADMIN_EMAIL" || -z "$USER_EMAIL" ]]; then
  echo "Usage: BASE_URL=<url> bash $0 <admin_email> <user_email> [admin_name] [user_name]" >&2
  exit 1
fi

jq_ok() { command -v jq >/dev/null 2>&1; }
read_csrf() { awk '$6=="evium_csrf" {print $7}' "$1" | tail -n1 || true; }
http_code() { sed -n '$p' <<<"$1"; }
http_body() { sed '$d' <<<"$1"; }
step() { echo; echo "[NEG] $*"; }

rm -f "$ADMIN_JAR" "$USER_JAR"

step "Health"
curl -sSf "$BASE_URL/u/healthz" | (jq_ok && jq . || cat)

# --- Admin login ---
step "Admin login"
SEND_A=$(curl -sSf -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"name\":\"$ADMIN_NAME\"}" "$BASE_URL/u/auth/send-otp")
CH_A=""; jq_ok && CH_A=$(echo "$SEND_A" | jq -r '.challengeId // empty') || true
read -r -p "Enter ADMIN OTP: " OTP_A
curl -sSf -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"otp\":\"$OTP_A\",\"challengeId\":\"$CH_A\"}" \
  "$BASE_URL/u/auth/verify" | (jq_ok && jq . || cat)
ADMIN_CSRF=$(read_csrf "$ADMIN_JAR")

# --- User login ---
step "User login"
SEND_U=$(curl -sSf -c "$USER_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$USER_EMAIL\",\"name\":\"$USER_NAME\"}" "$BASE_URL/u/auth/send-otp")
CH_U=""; jq_ok && CH_U=$(echo "$SEND_U" | jq -r '.challengeId // empty') || true
read -r -p "Enter USER OTP: " OTP_U
curl -sSf -b "$USER_JAR" -c "$USER_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$USER_EMAIL\",\"otp\":\"$OTP_U\",\"challengeId\":\"$CH_U\"}" \
  "$BASE_URL/u/auth/verify" | (jq_ok && jq . || cat)
USER_CSRF=$(read_csrf "$USER_JAR")

# --- invalid key ---
step "Invalid key should 401"
BADKEY=$(openssl rand -hex 20 2>/dev/null || echo abcdef0123456789abcdef0123456789abcdef)
R=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" -X POST "$BASE_URL/u/keys/redeem" \
  -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$BADKEY\"}")
RC=$(http_code "$R"); BODY=$(http_body "$R")
if [[ "$RC" != "401" ]]; then echo "$BODY"; echo "expected 401 invalid_key, got $RC" >&2; exit 1; fi

# --- expired key ---
step "Expired key should 409 (key_expired)"
M_EXP=$(curl -sSf -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"expiresAt":"1999-01-01T00:00:00Z"}' "$BASE_URL/u/admin/keys/mint")
K_EXP=$(jq -r '.key' <<<"$M_EXP" 2>/dev/null || echo "")
R_EXP=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" -X POST "$BASE_URL/u/keys/redeem" \
  -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$K_EXP\"}")
RC=$(http_code "$R_EXP"); BODY=$(http_body "$R_EXP")
if [[ "$RC" != "409" ]]; then echo "$BODY"; echo "expected 409 key_expired, got $RC" >&2; exit 1; fi

# --- revoked key ---
step "Revoked key should 409 (key_unavailable)"
M=$(curl -sSf -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-01-31T12:00:00Z"}' "$BASE_URL/u/admin/keys/mint")
K=$(jq -r '.key' <<<"$M" 2>/dev/null || echo "")
ID=$(jq -r '.id' <<<"$M" 2>/dev/null || echo "")
curl -sSf -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID\"}" "$BASE_URL/u/admin/keys/revoke" | (jq_ok && jq . || cat)
R2=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" -X POST "$BASE_URL/u/keys/redeem" \
  -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$K\"}")
RC=$(http_code "$R2"); BODY=$(http_body "$R2")
if [[ "$RC" != "409" ]]; then echo "$BODY"; echo "expected 409 key_unavailable, got $RC" >&2; exit 1; fi

# --- missing CSRF on POST ---
step "Missing CSRF should 403"
R3=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" -X POST "$BASE_URL/u/jobs/attach" \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"neg_case","type":"pipeline","network":"sepolia"}')
RC=$(http_code "$R3"); BODY=$(http_body "$R3")
if [[ "$RC" != "403" ]]; then echo "$BODY"; echo "expected 403 missing CSRF, got $RC" >&2; exit 1; fi

# --- non-admin hitting admin endpoints ---
step "Non-admin GET /u/admin/keys should 403"
R4=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" "$BASE_URL/u/admin/keys?limit=1")
RC=$(http_code "$R4"); BODY=$(http_body "$R4")
if [[ "$RC" != "401" && "$RC" != "403" ]]; then echo "$BODY"; echo "expected 401/403 for non-admin, got $RC" >&2; exit 1; fi

# --- refresh flow simulated 401 -> refresh -> retry ---
step "Simulate 401 by stripping access cookie, then refresh"
TMP_JAR=$(mktemp)
awk '$6!="evium_access"{print $0}' "$USER_JAR" > "$TMP_JAR" && mv "$TMP_JAR" "$USER_JAR"
ME401=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" "$BASE_URL/u/user/me" || true)
RC=$(http_code "$ME401"); BODY=$(http_body "$ME401")
if [[ "$RC" != "401" ]]; then echo "$BODY"; echo "expected 401 without access cookie, got $RC" >&2; exit 1; fi
REF=$(curl -sSf -b "$USER_JAR" -c "$USER_JAR" -X POST "$BASE_URL/u/auth/refresh" | (jq_ok && jq . || cat))
MEOK=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" "$BASE_URL/u/user/me")
RC=$(http_code "$MEOK"); BODY=$(http_body "$MEOK")
if [[ "$RC" != "200" ]]; then echo "$BODY"; echo "expected 200 after refresh, got $RC" >&2; exit 1; fi

step "Negative tests: OK"
