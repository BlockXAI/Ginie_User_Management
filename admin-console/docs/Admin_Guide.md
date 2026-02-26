# EVI Admin Console — Guide

This guide shows how to use the Admin Console UI to manage users and premium keys. It assumes the EVI User API is running and reachable.

- URL (local): http://localhost:3000
- API (local): http://localhost:8080

## Sign in

1) Open the Admin Console and enter your admin email.
2) Click "Send OTP".
   - If the system is in production OTP mode, a `challengeId` is created and an email is sent with your code.
   - If in development mode, the OTP appears in the API logs.
3) Enter the OTP and verify. You’ll be redirected to the Admin Dashboard.

Notes
- Only users with `role = admin` can access admin pages.
- If you are not an admin, ask an existing admin to add your email to the seed list or promote you.

## Dashboard

- Shows the signed-in admin (email, role).
- Quick navigation links: Users Lookup, Active Users, Keys.

## Users Lookup

Use to investigate a user and adjust entitlements or downgrade.

- Search:
  - Enter `email` or `user id` and click Search.
- View details:
  - `id`, `email`, `role`, `display_name`, `wallet_address`
  - Entitlements: `pro_enabled`, `wallet_deployments` (others may appear over time)
- Update entitlements:
  - Toggle checkboxes and click Save. Takes effect immediately.
- Downgrade:
  - Click "Downgrade to normal" to revert a pro user to normal.

## Active Users

- Displays a live list of users with active sessions.
- Columns: `email`, `role`, `display_name`, `last seen`, `id`.
- Use the "Limit" and "Refresh" controls to paginate and reload.

## Premium Keys

- Mint a key:
  - Optional: set `expiresAt` (ISO-8601, e.g., `2026-01-31T12:00:00Z`).
  - Click "Mint". The key is displayed once. Use "Copy" to copy it safely.
    - Keys are hashed at rest and cannot be retrieved later.
- List keys:
  - Filter by `status` (minted/redeemed/revoked) and set `limit`.
  - Columns: `id`, `status`, `expires`, `redeemed by`, `created`.
- Revoke a key:
  - Only keys in `minted` status may be revoked.
  - Revoking a key does not affect users who already redeemed it.

## Logout

- Click "Logout" in the top navigation.

## Troubleshooting

- Not authorized
  - You must have `role = admin`. Contact an existing admin.
- OTP issues
  - Production mode: check your email (and spam folder).
  - Development mode: read the OTP code in the API server logs.
- CSRF errors (403)
  - Ensure you signed in via the Admin Console so the CSRF cookie is set.
  - On 401, the console automatically calls refresh and retries.
- CORS issues
  - The API must allow credentials from the Admin Console origin via `APP_URL`.

## Security notes

- Sessions are cookie-based and rotate on login, refresh, and redeem.
- The Admin Console uses credentialed requests (`with credentials`) and CSRF headers for write endpoints.
- Keys are one-time tokens shown only to the admin who minted them.
