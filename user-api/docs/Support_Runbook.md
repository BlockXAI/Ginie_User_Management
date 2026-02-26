# Support Runbook

Use this guide for day-to-day support operations: user lookup, verifying role/entitlements, updating profile, toggling entitlements, troubleshooting auth/cookies, and listing active users.

## Prerequisites
- Admin access to the User API; your admin cookie jar (e.g., `/tmp/evium_admin.jar`).
- API base URL known per environment.

## 1) Lookup a user

By email or id:
```bash
curl -s -b "$ADMIN_JAR" "$BASE_URL/u/admin/user/lookup?email=user@example.com" | jq .
# or
curl -s -b "$ADMIN_JAR" "$BASE_URL/u/admin/user/lookup?id=<uuid>" | jq .
```
Checks:
- `user.role` in { normal, pro, admin }
- `entitlements.pro_enabled` and other flags
- `user.profile.organization`, `user.profile.role`, `user.display_name`, `user.wallet_address`

## 2) List active users (sessions)
```bash
curl -s -b "$ADMIN_JAR" "$BASE_URL/u/admin/users/active?limit=200" | jq .
```
Use to get current active emails/ids for troubleshooting and usage visibility.

## 3) Update user profile (on behalf of user)
- Preferred: ask the user to update via their session with CSRF.
- If necessary, coordinate a temporary session and have the user run:
```bash
USER_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$USER_JAR" | tail -n1)
curl -s -b "$USER_JAR" -X POST "$BASE_URL/u/user/profile" \
  -H "x-csrf-token: $USER_CSRF" -H 'Content-Type: application/json' \
  -d '{ "display_name": "Arpit", "profile": { "organization": "Acme", "role": "Engineer" } }' | jq .
```

## 4) Toggle entitlements (admin)
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$ADMIN_JAR" | tail -n1)
curl -s -b "$ADMIN_JAR" -X POST "$BASE_URL/u/admin/users/entitlements" \
  -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{ "email": "user@example.com", "pro_enabled": true, "wallet_deployments": true, "limits": { "daily_jobs": 25 } }' | jq .
```

## 5) Downgrade a user (revert to normal)
```bash
ADMIN_CSRF=$(awk '$6=="evium_csrf" {print $7}' "$ADMIN_JAR" | tail -n1)
curl -s -b "$ADMIN_JAR" -X POST "$BASE_URL/u/admin/users/downgrade" \
  -H "x-csrf-token: $ADMIN_CSRF" -H 'Content-Type: application/json' \
  -d '{ "email": "user@example.com" }' | jq .
```

## 6) Key lifecycle
- Mint (admin): `POST /u/admin/keys/mint` (returns key once)
- Revoke (admin): `POST /u/admin/keys/revoke` (affects minted/unused keys)
- Redeem (user): `POST /u/keys/redeem` (upgrades to pro)
- Get by id: `GET /u/admin/keys/:id`
- List: `GET /u/admin/keys?status=&limit=`

## 7) Troubleshooting

- Unauthorized after redeem/refresh:
  - Ensure the client persists rotated cookies (CLI: use `-b` and `-c` together; Frontend: call `/u/auth/refresh` then retry)
  - Re-read CSRF from jar after any rotation when making POST requests.
- OTP invalid (stateful): User must include `challengeId` from send-otp when calling verify.
- CSRF 403: Missing or mismatched `x-csrf-token` header vs `evium_csrf` cookie.
- Key revoked vs downgraded: Revoking after redeem does not change user; use downgrade endpoint.
- Metrics: `GET /u/metrics` shows counters and user counts by role; verify activity.

## 8) Escalation
- Capture timestamps, `request id` (if logged), and relevant audit logs.
- Check Sentry (if configured) for stack traces.
- Share minimal reproduction steps and jar handling details for CLI issues.
