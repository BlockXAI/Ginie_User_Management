# EVI User Management — Features Summary (Phase 0 → Present)

This is a plain-language overview for product, operations, and investors. It explains what is live today, why it matters, and how admins and users experience it. A technical appendix remains below for engineering reference. Convert this file to PDF when needed.

## Executive summary

- **[Passwordless sign-in]** Users sign in securely with a one-time code sent to their email. No passwords to remember or breach.
- **[Point‑and‑click Admin Console]** Admins can look up users, upgrade/downgrade access, and manage premium keys in seconds.
- **[Revenue‑ready upgrades]** “Premium Keys” let us grant Pro access instantly, even before a billing system is integrated.
- **[Built‑in safety]** Strong session security, CSRF protection, and rate limits keep accounts safe and abuse in check.
- **[Operational visibility]** Health checks and usage metrics are available now, with optional Sentry error tracking.

## What’s live today (outcomes, not just APIs)

- **[Simple sign‑in]** Users enter their email, receive a one-time code, and get in. No passwords, fewer support tickets, less friction.
- **[Clear roles]** Each account has a role: normal, pro, or admin. Admins control access; Pro unlocks premium capabilities.
- **[One‑click upgrades]** Admins can mint a Premium Key and share it. When a user redeems it, their account becomes Pro instantly.
- **[Account controls]** Admins can toggle entitlements (e.g., pro on/off, wallet deployments) and downgrade accounts when needed.
- **[Live activity view]** Admins can see who’s active right now to support operations and triage.
- **[Profile data that matters]** We capture name, organization, and role to power segmentation and success reporting. Wallet address is supported when relevant.
- **[Resilient by default]** Built‑in rate limiting for OTP flows helps prevent spam and keeps service stable during spikes.

## How an admin uses it (happy path)

1. **Log in** to the Admin Console with their email and one‑time code.
2. **Find a user** by email or ID to review their profile and access level.
3. **Upgrade access** by minting a Premium Key and sharing it with the user.
4. **Adjust entitlements** (e.g., enable wallet deployments) as needed.
5. **Monitor activity** with the Active Users view and take action quickly.

## How a user experiences it

1. **Enter email** and receive a one‑time code.
2. **Verify the code** to sign in—no password required.
3. **Redeem a Premium Key** (if provided) to unlock Pro features immediately.

## Security and trust (why this approach is safe)

- **[No passwords]** Eliminates a major source of compromise and support burden.
- **[Secure cookies + rotation]** Sessions are protected and refreshed to reduce risk from token theft.
- **[CSRF protection]** Write actions require a valid, per‑session token to prevent cross‑site attacks.
- **[Rate limits]** OTP send/verify are limited to stop abuse while keeping the system responsive for real users.

## Operations and visibility

- **[Health checks]** Can be used by uptime monitors and deployment platforms.
- **[Usage metrics]** Totals by role (normal, pro, admin) and other counters enable simple dashboards.
- **[Error tracking (optional)]** Sentry can be enabled via environment variables for alerting and triage.

## Compatibility and deployment

- **[Works locally and in the cloud]** The Admin Console runs on Next.js; the API runs on Node.js/Express.
- **[Managed data stores]** Supports Railway‑managed Postgres and Redis. Local development can use Railway public proxies by default.
- **[Configuration]** Everything is environment‑driven, including app URL, data connections, and providers.

## Roadmap (next steps)

- **[Enforce Pro gating]** Apply entitlement checks to premium product features (wrapper in place; enforcement next).
- **[Admin efficiency]** Bulk key minting, richer search/filters, export of activity.
- **[Enterprise‑ready auth]** Optional SSO providers and stronger second‑factor options as needs grow.
- **[Observability]** Prebuilt Sentry dashboards and alert policies for spikes (403, redeem errors).

