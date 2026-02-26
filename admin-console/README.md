# EVI Admin Console

A production-ready web UI for administering the EVI User Management system.

- **Tech**: Next.js 14 (App Router) + TailwindCSS + Lucide Icons
- **Location**: `Evi_User_Management/admin-console/`
- **Features**: User lookup, active users, premium keys management
- **Security**: CSRF protection, HttpOnly cookies, auto token refresh

## Quick Start

### Prerequisites

1) Ensure the API is running at `http://localhost:8080` with:
   - `APP_URL=http://localhost:3000` in `user-api/.env`
   - `SEED_ADMIN_EMAILS` contains your admin email

2) Configure and run the Admin Console:
```bash
cd Evi_User_Management/admin-console
cp .env.local.example .env.local
# Edit .env.local if your API runs elsewhere
npm install
npm run dev
# Open http://localhost:3000
```

## Login flow

- Enter your admin email and click "Send OTP".
  - In `OTP_PROVIDER_MODE=prod`, the API returns a `challengeId` and sends OTP via email.
  - In `dev` mode, the OTP appears in API logs.
- Enter OTP and verify; you’ll be redirected to `/admin`.
- Only users with `role: "admin"` can access admin pages. Others see an authorization error.

## Pages

- Dashboard (`/admin`)
  - Shows signed-in admin and quick links to tools.

- Users Lookup (`/admin/users/lookup`)
  - Search by `email` or `id` via `GET /u/admin/user/lookup`.
  - View `user`, `entitlements`.
  - Update entitlements via `POST /u/admin/users/entitlements`.
  - Downgrade user to `normal` via `POST /u/admin/users/downgrade`.

- Active Users (`/admin/users/active`)
  - List current active users via `GET /u/admin/users/active?limit=`.
  - Columns: email, role, display name, last seen, id.

- Premium Keys (`/admin/keys`)
  - Mint via `POST /u/admin/keys/mint` (optional `expiresAt` ISO string).
  - Newly minted key is shown once; copy with the button provided.
  - List keys with optional `status` and `limit` filters: `GET /u/admin/keys`.
  - Revoke a `minted` key via `POST /u/admin/keys/revoke`.

## Security model (how requests work)

- Cookies and CSRF
  - The API sets `evium_access`, `evium_refresh` (HttpOnly) and `evium_csrf` (readable) cookies on the `localhost` domain.
  - The Admin Console uses `credentials: 'include'` and reads `evium_csrf` from `document.cookie` to send it in `x-csrf-token` on write operations.
  - On `401` responses, the UI auto-calls `POST /u/auth/refresh` and retries once.

- CORS
  - The API allows credentials from `env.APP_URL`. For local development, set `APP_URL=http://localhost:3000` in `user-api/.env`.

## Troubleshooting

- Can’t access admin routes
  - Ensure your email is in `SEED_ADMIN_EMAILS` and restart the API.
  - Verify via `GET /u/user/me` that `role` is `admin`.

- CSRF 403
  - Make sure you logged in via the Admin Console so `evium_csrf` is set.
  - If you see 401 first, it should auto-refresh and then retry.

- OTP issues
  - In `prod` mode, make sure Brevo/email settings are configured.
  - In `dev` mode, check API logs for the OTP.

## Deployment

### Vercel (Recommended)

1) Push to GitHub
2) Import project in Vercel
3) Set environment variables:
   - `NEXT_PUBLIC_API_BASE_URL` (optional, rewrites handle this)
4) Deploy

The `vercel.json` includes:
- Security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
- API rewrites to the Railway backend

### Production Configuration

1) Set `APP_URL` in the API to match your deployed frontend URL
2) Configure `NEXT_PUBLIC_API_BASE_URL` if not using rewrites
3) Ensure HTTPS is used (cookies are `Secure` in production)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on :3000 |
| `npm run build` | Create production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test:e2e` | Run Playwright tests |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Backend API URL (client-side) | Empty (uses rewrites) |
| `BACKEND_URL` | Backend URL for Next.js rewrites | Railway URL |
