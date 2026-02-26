# Admin Upgrade Runbook

This runbook explains how an admin upgrades a user to Pro using Premium Keys and how to verify and troubleshoot.

## Prerequisites
- You are logged in as an admin (role `admin`).
- You have your admin cookie jar (e.g., `/tmp/evium_admin.jar`).
- API base URL: `http://localhost:8080` (adjust per env).

## 1) Admin login (stateful OTP)
```bash
ADMIN_JAR=/tmp/evium_admin.jar; rm -f "$ADMIN_JAR"
SEND=$(curl -s -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d '{"identity":"admin@example.com","name":"Admin"}' \
  http://localhost:8080/u/auth/send-otp)
CH_ID=$(echo "$SEND" | jq -r '.challengeId')
read "ADMIN_OTP?Enter OTP: "
curl -s -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"admin@example.com\",\"otp\":\"$ADMIN_OTP\",\"challengeId\":\"$CH_ID\"}" \
  http://localhost:8080/u/auth/verify | jq .
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$ADMIN_JAR" | tail -n1)
```

## 2) Mint a premium key
```bash
MINT=$(curl -s -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-01-31T12:00:00Z"}' \
  http://localhost:8080/u/admin/keys/mint)
KEY=$(echo "$MINT" | jq -r '.key')     # Opaque key (share with the user)
KEY_ID=$(echo "$MINT" | jq -r '.id')   # Internal id (for auditing)
echo "$MINT" | jq .
```
- IMPORTANT: The opaque `key` is shown once. Record it securely to deliver to the user.

## 3) Deliver the key to the user
Use a secure channel (email, support tool). Never paste keys in public channels.

## 4) User redeems the key (summary)
The user signs in with OTP and calls:
```bash
USER_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$USER_JAR" | tail -n1)
curl -s -b "$USER_JAR" -c "$USER_JAR" -X POST http://localhost:8080/u/keys/redeem \
  -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$KEY\"}" | jq .
```
- Note: Cookies rotate on success. The user should re-read `evium_csrf` from the jar afterwards.

## 5) Verify upgrade
```bash
# As admin, look up the user
curl -s -b "$ADMIN_JAR" "http://localhost:8080/u/admin/user/lookup?email=user@example.com" | jq .
# Expect role: "pro" and entitlements.pro_enabled: true

# Check metrics
curl -s http://localhost:8080/u/metrics | jq .
# keysMint, keysRedeem, roleUpgrade, entitlementsUpdate counters incremented
```

## 6) Revoke vs Downgrade
- Revoking a key only affects keys still in `minted` state (unused).
- If a user already redeemed a key, revoking it later does NOT change the user role.
- To revert: use downgrade.
```bash
curl -s -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com"}' \
  http://localhost:8080/u/admin/users/downgrade | jq .
```

## 7) Active users (visibility)
```bash
curl -s -b "$ADMIN_JAR" "http://localhost:8080/u/admin/users/active?limit=100" | jq .
```

## 8) Direct entitlements update (optional)
```bash
curl -s -b "$ADMIN_JAR" -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","wallet_deployments":true,"limits":{"daily_jobs":25}}' \
  http://localhost:8080/u/admin/users/entitlements | jq .
```

## Troubleshooting
- Unauthorized after redeem: the client didn’t persist rotated cookies. Use `-b` and `-c` together and refresh CSRF.
- OTP invalid (stateful mode): missing/incorrect `challengeId` passed to `/u/auth/verify`.
- Key invalid/expired/unavailable: generic 4xx; mint a new key.
- Metrics: counters and user counts are exposed at `/u/metrics`.
