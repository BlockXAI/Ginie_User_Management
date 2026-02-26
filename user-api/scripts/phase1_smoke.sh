#!/usr/bin/env bash
set -euo pipefail

# Phase 1 smoke: admin mint -> user redeem -> entitlements update -> downgrade
# Usage:
#   BASE_URL=http://localhost:8080 bash scripts/phase1_smoke.sh <admin_email> <user_email> [admin_name] [user_name]
# Prompts for OTPs interactively. Works for both dev/prod OTP modes.

BASE_URL=${BASE_URL:-http://localhost:8080}
ADMIN_EMAIL=${1:-}
USER_EMAIL=${2:-}
ADMIN_NAME=${3:-Admin}
USER_NAME=${4:-User}
ADMIN_JAR=${ADMIN_JAR:-/tmp/evium_admin_phase1.jar}
USER_JAR=${USER_JAR:-/tmp/evium_user_phase1.jar}

if [[ -z "$ADMIN_EMAIL" || -z "$USER_EMAIL" ]]; then
  echo "Usage: BASE_URL=<url> bash $0 <admin_email> <user_email> [admin_name] [user_name]" >&2
  exit 1
fi

jq_installed() { command -v jq >/dev/null 2>&1; }
read_csrf() { awk '$6=="evium_csrf" {print $7}' "$1" | tail -n1 || true; }
http_code() { sed -n '$p' <<<"$1"; }
http_body() { sed '$d' <<<"$1"; }

step() { echo; echo "[SMOKE] $*"; }
say() { echo "  - $*"; }

rm -f "$ADMIN_JAR" "$USER_JAR"

step "Health check"
curl -sSf "$BASE_URL/u/healthz" | (jq_installed && jq . || cat)

# --- Admin login ---
step "Admin send OTP ($ADMIN_EMAIL)"
SEND_A=$(curl -sSf -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"name\":\"$ADMIN_NAME\"}" \
  "$BASE_URL/u/auth/send-otp")
CH_A=""; jq_installed && CH_A=$(echo "$SEND_A" | jq -r '.challengeId // empty') || true
say "challengeId: ${CH_A:-<none>}"
read -r -p "Enter ADMIN OTP: " OTP_A

step "Admin verify OTP"
VERIFY_A=$(curl -sSf -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"otp\":\"$OTP_A\",\"challengeId\":\"$CH_A\"}" \
  "$BASE_URL/u/auth/verify")
ROLE_A=""; jq_installed && ROLE_A=$(echo "$VERIFY_A" | jq -r '.user.role // empty') || true
say "role after login: ${ROLE_A:-unknown}"
if [[ "$ROLE_A" != "admin" ]]; then
  echo "Admin role required. Make sure SEED_ADMIN_EMAILS includes $ADMIN_EMAIL and restart the API." >&2
  exit 1
fi
ADMIN_CSRF=$(read_csrf "$ADMIN_JAR")

# --- Admin mint key ---
step "Admin mint key"
MINT=$(curl -sSf -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-01-31T12:00:00Z"}' \
  "$BASE_URL/u/admin/keys/mint")
if jq_installed; then
  KEY=$(echo "$MINT" | jq -r '.key')
  KEY_ID=$(echo "$MINT" | jq -r '.id')
else
  echo "$MINT"
  read -r -p "Paste KEY from output: " KEY
  read -r -p "Paste KEY_ID from output: " KEY_ID
fi
say "minted: key_id=$KEY_ID"

# --- User login ---
step "User send OTP ($USER_EMAIL)"
SEND_U=$(curl -sSf -c "$USER_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$USER_EMAIL\",\"name\":\"$USER_NAME\"}" \
  "$BASE_URL/u/auth/send-otp")
CH_U=""; jq_installed && CH_U=$(echo "$SEND_U" | jq -r '.challengeId // empty') || true
say "challengeId: ${CH_U:-<none>}"
read -r -p "Enter USER OTP: " OTP_U

step "User verify OTP"
VERIFY_U=$(curl -sSf -b "$USER_JAR" -c "$USER_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$USER_EMAIL\",\"otp\":\"$OTP_U\",\"challengeId\":\"$CH_U\"}" \
  "$BASE_URL/u/auth/verify")
USER_CSRF=$(read_csrf "$USER_JAR")

# --- User redeem ---
step "User redeem premium key"
REDEEM=$(curl -sS -w "\n%{http_code}\n" -b "$USER_JAR" -c "$USER_JAR" -X POST "$BASE_URL/u/keys/redeem" \
  -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$KEY\"}")
RC=$(http_code "$REDEEM"); BODY=$(http_body "$REDEEM")
if [[ "$RC" != "200" ]]; then echo "$BODY"; echo "redeem failed: $RC" >&2; exit 1; fi
USER_CSRF=$(read_csrf "$USER_JAR")

# --- Verify pro ---
step "Verify /me shows role=pro"
ME=$(curl -sSf -b "$USER_JAR" "$BASE_URL/u/user/me")
ROLE=$(jq -r '.user.role' <<<"$ME" 2>/dev/null || echo "")
if [[ "$ROLE" != "pro" ]]; then echo "$ME"; echo "expected role pro" >&2; exit 1; fi
say "role=pro ok"

# --- Admin entitlements update ---
step "Admin set wallet_deployments=true"
ADMIN_CSRF=$(read_csrf "$ADMIN_JAR")
ENT=$(curl -sS -w "\n%{http_code}\n" -b "$ADMIN_JAR" -X POST "$BASE_URL/u/admin/users/entitlements" \
  -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"wallet_deployments\":true}")
RC=$(http_code "$ENT"); BODY=$(http_body "$ENT")
if [[ "$RC" != "200" ]]; then echo "$BODY"; echo "entitlements update failed: $RC" >&2; exit 1; fi
say "entitlements updated"

# --- Admin downgrade user ---
step "Admin downgrade user to normal"
ADMIN_CSRF=$(read_csrf "$ADMIN_JAR")
DOWN=$(curl -sS -w "\n%{http_code}\n" -b "$ADMIN_JAR" -X POST "$BASE_URL/u/admin/users/downgrade" \
  -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\"}")
RC=$(http_code "$DOWN"); BODY=$(http_body "$DOWN")
if [[ "$RC" != "200" ]]; then echo "$BODY"; echo "downgrade failed: $RC" >&2; exit 1; fi

step "Verify /me shows role=normal after downgrade (may need refresh)"
REF=$(curl -sSf -b "$USER_JAR" -c "$USER_JAR" -X POST "$BASE_URL/u/auth/refresh" || true)
ME2=$(curl -sSf -b "$USER_JAR" "$BASE_URL/u/user/me")
ROLE2=$(jq -r '.user.role' <<<"$ME2" 2>/dev/null || echo "")
if [[ "$ROLE2" != "normal" ]]; then echo "$ME2"; echo "expected role normal" >&2; exit 1; fi

step "Smoke test: OK"
