# Cookie Policy & TTLs (User Platform)

Last updated: 2025-10-23

This document defines the cookies used by the User Platform, their flags, TTLs, rotation rules, and CSRF handling.

---

## Cookies Overview

- **evium_access**
  - Purpose: Authenticates requests to `/u/*` endpoints.
  - Type: Opaque random token (>= 32 bytes) stored only as a hash server-side (`sessions.session_hash`).
  - TTL: 90 minutes (Phase 0 target). Range 60–120 minutes acceptable.
  - Flags: `HttpOnly; Secure; SameSite=Strict; Path=/`.
  - Domain: parent domain if subdomains are used (e.g., `.yourapp.com`), otherwise omit.

- **evium_refresh**
  - Purpose: Obtain new `evium_access` tokens silently.
  - Type: Opaque random token (>= 32 bytes) stored as a hash server-side (`sessions.refresh_hash`).
  - TTL: 30 days.
  - Flags: `HttpOnly; Secure; SameSite=Strict; Path=/`.
  - Rotation: Rotated on each refresh; old refresh invalidated immediately (DB update).

- **evium_csrf** (optional)
  - Purpose: Double-submit CSRF token.
  - Type: Non-HttpOnly random value; mirrored in `X-CSRF-Token` header on mutating `/u/*` routes.
  - TTL: Align with `evium_access` or shorter (e.g., 30–90 minutes).
  - Flags: `Secure; SameSite=Strict; Path=/`.

---

## Rotation Rules

- On successful `/u/auth/verify`:
  - Issue `evium_access` (90m) and `evium_refresh` (30d).
- On refresh:
  - Validate `evium_refresh` → issue new `evium_access` + new `evium_refresh`.
  - Invalidate prior refresh (set new `refresh_hash` in DB), preserve session continuity.
- On logout:
  - Revoke session in DB (`revoked_at = now()`), clear both cookies.
- On role/entitlement change:
  - Optional: rotate `evium_access` to reflect privileges; invalidate `/u/user/me` cache.

---

## CSRF Model

- Cookies are `SameSite=Strict` which reduces cross-site cookie sending.
- For defense-in-depth, require `X-CSRF-Token` on all mutating `/u/*` routes.
- Compare header with `evium_csrf` cookie value. Reject on mismatch.
- Exempt `GET /u/user/me` and `POST /u/auth/verify` if you derive CSRF from one-time states (optional).

---

## Example Set-Cookie Headers

```
Set-Cookie: evium_access=ACCESS_TOKEN; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=5400
Set-Cookie: evium_refresh=REFRESH_TOKEN; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000
Set-Cookie: evium_csrf=CSRF_VALUE; Secure; SameSite=Strict; Path=/; Max-Age=3600
```

Notes:
- Use `Expires` or `Max-Age`; modern clients support `Max-Age` reliably.
- Do not include `Domain` unless you need sharing across subdomains.
- Ensure `Secure` in production (HTTPS only).

---

## Security Notes

- Store only hashes of tokens (argon2id recommended, or bcrypt with high cost).
- Never log token values; log only request IDs and user/session IDs.
- Tie session `device_info` and IP to help detect anomalies.
- Invalidate sessions on suspicion of compromise.

---

## Operational Considerations

- Invalidate `/u/user/me` Redis cache when sessions or entitlements change.
- Monitor 401/403 rates to spot cookie expiry or CSRF errors.
- Provide clear UI messaging when session expires (graceful re-auth).
