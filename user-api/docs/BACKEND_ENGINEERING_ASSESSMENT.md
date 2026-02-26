# EVI User-API — Backend Engineering & Scalability Assessment

This document evaluates `Evi_User_Management/user-api` from a **backend engineering** perspective using the concepts list you shared (HTTP, routing, auth, validation, middleware, context, databases, caching, observability, reliability, security, scaling, testing, etc.).

It is intentionally **implementation-driven**: every section maps to what is **Implemented / Partially Implemented / Missing**, with references to the codebase.

---

## 1) What this backend is (big picture)

### Purpose
`user-api` is a **User Management + Gateway/Wrapper** service. It provides:

- **User auth** (passwordless OTP)
- **Session management** (cookie-based, server-side sessions in Postgres)
- **User profile** (metadata + avatars)
- **Job ownership + job metadata** (tracks upstream “pipeline jobs” by `jobId`)
- **Proxy/wrapper endpoints** to upstream EVI services (pipeline create, job status/detail/logs, artifacts, audit, compliance, verification)
- **RBAC + Entitlements** (normal/pro/admin + feature flags)
- **Operational endpoints** (`/u/healthz`, `/u/metrics`, Swagger UI)

### Key files
- **Server entrypoint**: `src/index.ts`
- **Configuration**: `src/env.ts`
- **Database**: `src/db.ts`
- **Redis**: `src/redis.ts`
- **Rate limiting**: `src/rateLimit.ts`
- **Auth/RBAC middleware**: `src/authz.ts`
- **OTP providers**: `src/otp.ts`
- **Networks registry**: `src/networks.ts`
- **OpenAPI**: `src/openapi.ts`

### Data stores
- **PostgreSQL**: users, sessions, jobs, entitlements, keys, audit logs, avatars
- **Redis**: OTP state (dev + prod), rate limiting counters, simple metrics counters

### External dependencies
- **Upstream EVI service** (pipeline + artifacts + verify etc): `env.EVI_BASE_URL` / `env.EVI_V4_BASE_URL`
- **Email provider** (Brevo) for OTP delivery (prod mode)
- **Cloudflare Turnstile** (optional CAPTCHA)
- **Sentry** (optional error tracking)

---

## 2) Request flow (browser → server → DB/Redis → upstream)

### Typical authenticated flow
1. Browser calls `POST /u/auth/send-otp` (CORS enforced).
2. Browser calls `POST /u/auth/verify` with OTP.
3. Server sets cookies:
   - `evium_access` (HttpOnly)
   - `evium_refresh` (HttpOnly)
   - `evium_csrf` (readable)
4. Browser calls job endpoints, always with `credentials: include`.
5. Mutating endpoints require header `x-csrf-token` matching cookie `evium_csrf`.
6. User job actions either:
   - operate purely in Postgres (list jobs, update metadata, delete)
   - or proxy to upstream EVI service (job detail/status/logs/artifacts/verify)

### Key invariants
- **Ownership**: proxy endpoints generally verify the job is attached to the user via `user_jobs`.
- **Rate limiting**: most sensitive endpoints are rate-limited via Redis.
- **Stateless app nodes**: state is in Postgres/Redis; multiple instances can run.

---

## 3) Capability Matrix (Implemented vs Missing)

Legend:
- **Implemented**: present and used in production paths
- **Partial**: present but incomplete / missing best-practice parts
- **Missing**: not implemented in this codebase

### 3.1 Networking fundamentals / “how requests travel”
- **Implemented**
  - **CORS** via `cors` middleware in `src/index.ts`.
  - **Proxy-aware IP** support via `TRUST_PROXY` (`app.set('trust proxy', 1)`).
- **Partial**
  - There is no explicit **reverse proxy config** doc (nginx/Cloudflare) inside this repo; Railway/Vercel setups exist outside.
- **Missing**
  - End-to-end tracing IDs across hops (browser → Next proxy → user-api → upstream).

### 3.2 HTTP semantics (methods, status codes, content negotiation)
- **Implemented**
  - Uses correct verbs for many endpoints:
    - `GET /u/jobs` list
    - `GET /u/jobs/:id` detail
    - `PATCH /u/jobs/:id/meta` update
    - `DELETE /u/jobs/:id` soft delete
  - Returns appropriate codes for auth and rate limit:
    - `401` unauthorized
    - `403` forbidden (CSRF)
    - `404` not_found
    - `429` rate_limited
  - **Content negotiation** for audit/compliance markdown vs JSON (`wantsMarkdown()` in `src/index.ts`).
- **Partial**
  - Some proxy failures return `502`, but other upstream-denied flows return `200` with `{ ok: false }` (example: pipeline 403 fallback logic). This is pragmatic, but not strictly HTTP-semantic.
- **Missing**
  - Systematic caching headers (ETag/If-None-Match) for read endpoints.
  - Compression middleware (gzip/brotli) at the app layer.

### 3.3 Routing (versioning, grouping, path/query)
- **Implemented**
  - Clean grouping using `/u/*` prefix.
  - Path params, query params used heavily.
  - Swagger docs are served at `/docs` and JSON at `/openapi.json`.
- **Partial**
  - There is no explicit **API versioning strategy** (`/v1`, headers, etc.).
- **Missing**
  - Deprecation policy + sunset headers.

### 3.4 Serialization / deserialization
- **Implemented**
  - JSON request bodies via `express.json()`.
  - JSON responses via `res.json()`.
- **Partial**
  - No explicit response schema validation / serialization layer (e.g. strict DTO mapping).
- **Missing**
  - Binary formats (protobuf), streaming JSON responses (except SSE).

### 3.5 Validation, normalization, sanitization
- **Implemented**
  - Request validation via **Zod** (`z.object(...).safeParse(...)`) across major endpoints.
  - Basic normalization:
    - `identity` lowercased and trimmed
    - numeric coercion via `z.coerce.number()`
- **Partial**
  - No centralized validation pipeline / reusable validators (each route repeats patterns).
  - Limited sanitization (no systematic HTML escaping / input sanitization library).
- **Missing**
  - JSON schema validation at boundary (OpenAPI-driven validation).
  - Central error detail formats (some endpoints return `{code}` only, others include more).

### 3.6 Middleware architecture
- **Implemented**
  - CORS, cookies, JSON parsing.
  - Request logging middleware (logs on `res.finish`).
  - Auth middleware (`requireAuth`) and RBAC (`requireRole`) and entitlements (`requireEntitlement`) in `src/authz.ts`.
- **Partial**
  - The logging middleware logs `ip: req.ip` (which depends on trust proxy settings) but does not include a request ID.
- **Missing**
  - Security headers middleware (Helmet).
  - Central auth/session middleware used consistently everywhere (some routes manually validate access cookie instead of `requireAuth`).

### 3.7 Request context (request scoped state)
- **Implemented**
  - `requireAuth` adds `(req as any).auth = { userId }`.
- **Partial**
  - No typed request context (TypeScript interface augmentation).
- **Missing**
  - Trace IDs propagated to upstream.
  - Cancellation/timeouts per request consistently (only some upstream calls use `AbortController`).

### 3.8 Authentication & Authorization
- **Implemented**
  - Passwordless OTP login (`/u/auth/send-otp`, `/u/auth/verify`).
  - Server-side sessions stored in Postgres (`sessions` table).
  - Token rotation on refresh (`/u/auth/refresh`).
  - CSRF mitigation via `evium_csrf` cookie + `x-csrf-token` header.
  - RBAC (`normal|pro|admin`) and entitlements.
- **Partial**
  - Session security:
    - Sessions are valid until expiry unless revoked; there’s no device fingerprinting beyond a `device_info` JSON.
    - No session listing/revocation endpoint (except logout of current session).
  - Cookies:
    - `SameSite` behavior is configurable and dynamic, good; but security expectations are deployment-dependent.
- **Missing**
  - OAuth/OIDC.
  - MFA beyond email OTP.
  - Fine-grained permissions model beyond role + entitlements.

### 3.9 Error handling
- **Implemented**
  - Global error handler at end of `src/index.ts`.
  - Sentry integration + `Sentry.expressErrorHandler()`.
  - Many endpoints return consistent `{ ok: false, error: { code } }`.
- **Partial**
  - Errors are not strongly typed; there is no central error taxonomy module.
  - Some upstream proxy errors don’t standardize `error.message`.
- **Missing**
  - Structured error envelopes with `request_id`, `details`, `retryable`, etc.

### 3.10 Databases (schema, indexes, transactions)
- **Implemented**
  - Postgres schema defined and created by `initSchema()` in `src/db.ts`.
  - Indexes exist for key access patterns:
    - `idx_user_jobs_user_created_at`
    - `idx_job_cache_state`, etc.
  - Simple transactions in DB for multi-step updates (e.g. `setUserRoleAndEntitlements`).
  - Connection pooling with `pg.Pool`.
- **Partial**
  - Schema management is runtime-driven (`initSchema()`), not migration-driven.
  - There is Prisma tooling in `package.json`, but runtime uses raw SQL via `pg`.
- **Missing**
  - Formal migration workflow (Prisma migrations or SQL migration tool) as the authoritative source.
  - Read replicas, sharding/partitioning strategies.

### 3.11 Caching
- **Implemented**
  - Redis used for:
    - OTP challenge state
    - rate limiting counters
    - metrics counters
- **Partial**
  - `job_cache` table provides a “cache layer” in Postgres, but cache invalidation strategy is manual (updated through `/u/jobs/cache`).
- **Missing**
  - HTTP caching strategies (ETags, cache-control).
  - High-level caching patterns (cache-aside for expensive reads).
  - In-memory L1 cache (with eviction strategy) where appropriate.

### 3.12 Task queues / background jobs / scheduling
- **Implemented**
  - None (inside this repo).
- **Partial**
  - Some asynchronous behavior is handled via polling (job status/logs) and SSE streaming.
- **Missing**
  - A job queue for:
    - email retries
    - verification retries
    - cleanup/pruning
    - scheduled maintenance

### 3.13 Real-time systems
- **Implemented**
  - **SSE** proxy: `/u/proxy/job/:id/logs/stream`.
  - **WebSocket server** (uses `ws`) for log streaming + artifact fetch + auto-verify after stream end (see bottom of `src/index.ts`).
- **Partial**
  - The SSE proxy includes retry attempts and keepalive pings; good.
  - There is no backpressure/flow control documentation.
- **Missing**
  - Pub/sub (Redis streams, Kafka, NATS) for event-driven architecture.

### 3.14 Observability (logging, monitoring, tracing)
- **Implemented**
  - JSON logs for requests.
  - Simple metrics endpoint (`/u/metrics`) backed by Redis counters.
  - Sentry error tracking (optional via env).
  - Health check endpoint (`/u/healthz`) checks DB init + Redis ping.
- **Partial**
  - Metrics are not Prometheus-format; they are app-specific JSON.
  - No structured log correlation IDs.
- **Missing**
  - Distributed tracing (OpenTelemetry).
  - RED metrics and SLIs/SLOs.
  - Alerting playbooks inside repo.

### 3.15 Security (OWASP, secure defaults)
- **Implemented**
  - CSRF protection for mutating endpoints.
  - Cookie-based auth with HttpOnly cookies.
  - Rate limiting via Redis.
  - CORS allowlist.
  - Turnstile CAPTCHA support.
  - Ownership checks for jobs.
  - Audit logs for sensitive actions.
- **Partial**
  - No global security headers.
  - No explicit SSRF defense for proxy endpoints (URLs are constructed from trusted base envs, which is good, but still worth documenting).
- **Missing**
  - CSP (mostly a frontend concern, but backend can set headers).
  - WAF/rules documentation.
  - Secrets rotation strategy documented.

### 3.16 Reliability / fault tolerance
- **Implemented**
  - Postgres query retry wrapper for transient errors (`withRetry` in `src/db.ts`).
  - Pool error handler to avoid unhandled rejections.
  - Upstream fetch timeouts for pipeline create, and retries for SSE streaming.
- **Partial**
  - No explicit circuit breaker around upstream dependency.
  - No bulkheads (separate pools/limits per upstream route class).
- **Missing**
  - Graceful shutdown (SIGTERM handling, drain in-flight requests, close DB/Redis cleanly).
  - Chaos testing / failure injection.

### 3.17 Scalability & performance
- **Implemented**
  - Stateless node design (state is in Postgres/Redis).
  - DB pooling configured (`max: 20`).
  - Cursor pagination for `/u/jobs`.
- **Partial**
  - `initSchema()` is invoked on `/u/healthz`; health endpoint can become heavy if called frequently.
  - Rate limiting is simple `INCR` without sliding window; good enough but coarse.
- **Missing**
  - Load testing suite.
  - Performance profiling and budgets.
  - Automatic caching of upstream responses.

### 3.18 Testing & quality
- **Implemented**
  - Bash-based smoke/e2e scripts (`scripts/*`) documented in `docs/TESTING.md`.
- **Partial**
  - No unit tests / integration tests in a framework (Jest/Vitest).
- **Missing**
  - CI pipeline enforcing tests + lint + typecheck.
  - Contract tests for upstream API.

### 3.19 Config management
- **Implemented**
  - Centralized env parsing + validation in `src/env.ts`.
  - Rate limit knobs are env-configurable.
- **Partial**
  - No per-environment config files committed (expected; secrets should not be in repo).
- **Missing**
  - Feature flag service.
  - Secret management runbook inside this repo (Railway/Vercel side).

### 3.20 OpenAPI / API-first
- **Implemented**
  - `src/openapi.ts` exists and Swagger UI is served.
- **Partial**
  - The OpenAPI spec does not appear to be the single source of truth (routes are not generated from it).
- **Missing**
  - Validation generated from OpenAPI.
  - Versioned spec release process.

---

## 4) What we are strong at (today)

- **Pragmatic security baseline**: CSRF + HttpOnly cookies + CORS allowlist + rate limiting + audit logs.
- **Works well as a gateway**: strong job ownership checks before proxying to upstream.
- **Good “developer velocity” choices**:
  - Zod validation inline
  - scripts for E2E testing
  - OpenAPI docs hosted at `/docs`

---

## 5) Where the backend is lacking (highest impact gaps)

### 5.1 Graceful shutdown (reliability)
**Gap**: No SIGTERM/SIGINT handlers to:
- stop accepting new requests
- drain keepalive connections / SSE
- close Postgres pool
- close Redis

**Impact**: higher error rates during deploys/scaling events.

### 5.2 Observability: request IDs + tracing
**Gap**: No request correlation ID.

**Impact**: debugging distributed failures is harder (frontend proxy → user-api → upstream).

### 5.3 Metrics are not production-grade
**Gap**: `/u/metrics` is JSON counters, not Prometheus.

**Impact**: hard to build reliable SLO dashboards/alerts.

### 5.4 Migration strategy consistency
**Gap**: runtime schema init exists, Prisma tooling exists, but authoritative workflow is unclear.

**Impact**: schema drift risk and operational risk at scale.

### 5.5 Background jobs
**Gap**: no queue.

**Impact**: many operations become request-path work (email, verification retries, periodic cleanup).

---

## 6) “Full-proof” roadmap (prioritized)

### P0 (Immediate hardening)
- Add **graceful shutdown**.
- Add **request IDs**:
  - generate per request
  - return header `x-request-id`
  - log it everywhere
- Standardize error format: `{ ok:false, error:{ code, message?, request_id? } }`.

### P1 (Production observability)
- Add Prometheus metrics (`/metrics`) with:
  - request duration histogram
  - request counts by route/status
  - upstream latency + error counts
  - redis/db error counters
- Add OpenTelemetry tracing (even sampling) with trace propagation.

### P2 (Scalability)
- Rework schema management:
  - pick one: **Prisma migrations** OR **SQL migrations**
  - remove runtime `initSchema()` from health check (or make it a startup hook)
- Implement caching strategy for upstream reads (optional) and define invalidation.

### P3 (Reliability / fault tolerance)
- Add circuit breaker / retry/backoff policies for upstream services.
- Add background job queue for verification retries, email delivery retries.

### P4 (Testing maturity)
- Add unit tests for:
  - auth cookie logic
  - rate limiting
  - CSRF checks
  - job ownership
- Add integration test harness (testcontainers or docker compose).

---

## 7) Summary table (quick glance)

| Area | Status |
|------|--------|
| HTTP + routing fundamentals | Implemented (no versioning) |
| Validation | Implemented (Zod), partial standardization |
| AuthN/AuthZ | Implemented (OTP + sessions + RBAC + entitlements) |
| Security | Implemented baseline (CSRF/CORS/RL), missing headers/hardening |
| DB | Implemented (pg + pooling + indexes), migration workflow unclear |
| Caching | Implemented (Redis for OTP/RL), missing broader caching |
| Queues | Missing |
| Real-time | Implemented (SSE + WS) |
| Observability | Partial (logs + Sentry + custom metrics), missing tracing/Prometheus |
| Graceful shutdown | Missing |
| Testing | Partial (bash scripts), missing unit/integration harness |

---

## 8) Notes specific to your “scalability” lens

This backend can scale horizontally because:
- sessions are stored in Postgres
- rate limits are stored in Redis
- state is not kept in memory (except transient streaming connections)

The main scalability risks are:
- **upstream dependency bottlenecks** (pipeline service)
- missing **circuit breakers**
- missing **observability for SLA/SLO management**
- unclear migration strategy at scale

---

## 9) References

- `src/index.ts` — routing, middleware, auth endpoints, jobs endpoints, proxy endpoints, SSE/WS streaming, global error handler
- `src/env.ts` — environment config + validation
- `src/db.ts` — schema, pooling, retries, core data model
- `src/rateLimit.ts` — Redis rate limiter
- `src/authz.ts` — auth middleware, RBAC, entitlements
- `src/otp.ts` — OTP providers (dev + stateful)
- `docs/TESTING.md` — e2e testing scripts and flows
