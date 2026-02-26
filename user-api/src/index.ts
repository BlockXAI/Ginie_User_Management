import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { env } from './env.js';
import { openApiSpec } from './openapi.js';
import { initSchema, upsertUserByEmail, ensureEntitlements, getEntitlements, findValidSessionByHash, createSession, revokeSessionByHash, insertAuditLog, attachUserJob, listUserJobs, getUserJobWithCache, upsertJobCache, findSessionByRefreshHash, updateSessionTokens, getUserById, getUserByEmail, createPremiumKey, findPremiumKeyByLookupHash, redeemPremiumKeyAndGrantPro, updatePremiumKeyStatus, listPremiumKeys, setUserRoleAndEntitlements, markPremiumKeyRedeemed, updateUserDisplayName, findPremiumKeyById, updateUserProfile, countUsers, listActiveUsers, insertUserAvatar, getUserAvatarById, deleteUserAvatar, pruneUserAvatars, listUserAvatars, userOwnsJob, countUserJobsSummary, countUserJobsSince, updateJobMeta, softDeleteUserJob, listUserAuditLogs, createBuilderProjectMapping, listBuilderProjects, getBuilderProjectById, getBuilderProjectByFbId, updateBuilderProjectCache, softDeleteBuilderProject } from './db.js';
import { pingRedis } from './redis.js';
import { allow } from './rateLimit.js';
import { DevOtpProvider, StatefulOtpProvider, OtpProvider } from './otp.js';
import { randomToken, tokenHash, getClientIp } from './utils.js';
import { z } from 'zod';
import * as Sentry from '@sentry/node';
import { redis } from './redis.js';
import { requireAuth, requireRole, requireEntitlement, requireServiceAuth } from './authz.js';
import { Readable } from 'stream';
import { magicalFromLog } from './magical.js';
import { isNetworkSupported, getEnabledNetworks, getNetworkConfig, getNetworkDisplayName } from './networks.js';
import { SYSTEM_PROMPT, buildUserMessage, buildGeminiContent } from './prompts.js';

process.on('unhandledRejection', (reason: any) => {
  try {
    console.error(JSON.stringify({ level: 'error', msg: 'process.unhandledRejection', error: String(reason?.message || reason) }));
  } catch {}
});
process.on('uncaughtException', (err: any) => {
  try {
    console.error(JSON.stringify({ level: 'error', msg: 'process.uncaughtException', error: String(err?.message || err), stack: err?.stack }));
  } catch {}
});

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Wrap async handlers so rejected promises are forwarded to Express error middleware
{
  const wrap = (h: any) => {
    if (typeof h !== 'function') return h;
    return (req: Request, res: Response, next: any) => {
      try {
        const out = h(req, res, next);
        if (out && typeof out.then === 'function') out.catch(next);
      } catch (e) {
        next(e);
      }
    };
  };
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'all'] as const;
  for (const m of methods) {
    const orig = (app as any)[m].bind(app);
    (app as any)[m] = (path: any, ...handlers: any[]) => orig(path, ...handlers.map(wrap));
  }
}
app.use(cookieParser());
app.use(cors({
  origin: (origin, cb) => {
    // Combine APP_URL and APP_URLS into a single allowed list
    const allowed = [env.APP_URL, ...(env.APP_URLS || [])].filter(Boolean);
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // Check if origin is in the allowed list
    if (allowed.includes(origin)) return cb(null, true);
    // Also check without trailing slash for flexibility
    const originNoSlash = origin.replace(/\/$/, '');
    if (allowed.some(a => a.replace(/\/$/, '') === originNoSlash)) return cb(null, true);
    // Dev convenience: allow localhost/127.0.0.1 on common dev ports
    try {
      if (env.NODE_ENV === 'development') {
        const u = new URL(origin);
        const hostOk = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
        const portOk = ['3000', '3100', '3001', '5173', '5174', '8080'].includes(u.port);
        if (hostOk && portOk) return cb(null, true);
      }
    } catch {}
    // Log rejected origins for debugging (include allowed list for easier troubleshooting)
    console.warn(JSON.stringify({ level: 'warn', msg: 'cors_rejected', origin, allowed: allowed.slice(0, 10) }));
    // Return false without error to avoid 500; browser will block due to missing CORS headers
    return cb(null, false);
  },
  credentials: true,
}));
if (String(env.TRUST_PROXY).toLowerCase() === '1' || String(env.TRUST_PROXY).toLowerCase() === 'true') {
  app.set('trust proxy', 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Root & Documentation Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET / - API info landing page
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'EVI User Management API',
    version: '1.0.0',
    description: 'Backend API for EVI user authentication, session management, and pipeline orchestration.',
    status: 'running',
    endpoints: {
      health: '/u/healthz',
      docs: '/docs',
      auth: '/u/auth/*',
      user: '/u/user/*',
      jobs: '/u/jobs/*',
      proxy: '/u/proxy/*',
      admin: '/u/admin/*',
    },
    links: {
      documentation: '/docs',
      health_check: '/u/healthz',
    },
  });
});

// Swagger UI - API documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'EVI User Management API Docs',
}));

// OpenAPI spec as JSON
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// GET /u/networks - List all supported networks
app.get('/u/networks', (_req: Request, res: Response) => {
  const networks = getEnabledNetworks().map(n => ({
    id: n.id,
    name: n.name,
    chainId: n.chainId,
    blockExplorer: n.blockExplorer,
    testnet: n.testnet,
    nativeCurrency: n.nativeCurrency,
  }));
  res.json({ ok: true, networks });
});

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENV || env.NODE_ENV,
    tracesSampleRate: Number(env.SENTRY_SAMPLE_RATE || 0) || 0,
    integrations: [Sentry.expressIntegration()],
  });

  // Wrapper: GET artifacts (root)
  app.get('/u/proxy/artifacts', async (req: Request, res: Response) => {
    const access = req.cookies?.[ACCESS_COOKIE];
    if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    try {
      const jobId = String(req.query.jobId || '') || String(req.query.jobID || '');
      if (jobId) {
        const own = await userOwnsJob(sess.user_id, jobId);
        if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      }
    } catch {}
    const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
    const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    const url = `${env.EVI_BASE_URL}/api/artifacts${qs}`;
    const r = await fetch(url);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  });

  // Wrapper: GET artifacts/sources
  app.get('/u/proxy/artifacts/sources', async (req: Request, res: Response) => {
    const access = req.cookies?.[ACCESS_COOKIE];
    if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    try {
      const jobId = String(req.query.jobId || '') || String(req.query.jobID || '');
      if (jobId) {
        const own = await userOwnsJob(sess.user_id, jobId);
        if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      }
    } catch {}
    const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
    const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    const url = `${env.EVI_BASE_URL}/api/artifacts/sources${qs}`;
    const r = await fetch(url);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  });

  // Wrapper: GET artifacts/abis
  app.get('/u/proxy/artifacts/abis', async (req: Request, res: Response) => {
    const access = req.cookies?.[ACCESS_COOKIE];
    if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    try {
      const jobId = String(req.query.jobId || '') || String(req.query.jobID || '');
      if (jobId) {
        const own = await userOwnsJob(sess.user_id, jobId);
        if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      }
    } catch {}
    const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
    const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    const url = `${env.EVI_BASE_URL}/api/artifacts/abis${qs}`;
    const r = await fetch(url);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  });

  // Wrapper: GET artifacts/scripts
  app.get('/u/proxy/artifacts/scripts', async (req: Request, res: Response) => {
    const access = req.cookies?.[ACCESS_COOKIE];
    if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    try {
      const jobId = String(req.query.jobId || '') || String(req.query.jobID || '');
      if (jobId) {
        const own = await userOwnsJob(sess.user_id, jobId);
        if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      }
    } catch {}
    const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
    const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    const url = `${env.EVI_BASE_URL}/api/artifacts/scripts${qs}`;
    const r = await fetch(url);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  });

  // Wrapper: GET artifacts/audit
  app.get('/u/proxy/artifacts/audit', async (req: Request, res: Response) => {
    const access = req.cookies?.[ACCESS_COOKIE];
    if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    try {
      const jobId = String(req.query.jobId || '');
      if (jobId) {
        const own = await userOwnsJob(sess.user_id, jobId);
        if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      }
    } catch {}
    const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
    const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    const url = `${env.EVI_BASE_URL}/api/artifacts/audit${qs}`;
    const r = await fetch(url);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    if (wantsMarkdown(req) && out && typeof out === 'object') {
      try {
        const jobId = String(out?.jobId || req.query.jobId || '');
        const md = renderAuditMarkdown(jobId, out?.report || {});
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.status(r.status).send(md);
      } catch {}
    }
    return res.status(r.status).json(out ?? {});
  });

  // Wrapper: GET artifacts/compliance
  app.get('/u/proxy/artifacts/compliance', async (req: Request, res: Response) => {
    const access = req.cookies?.[ACCESS_COOKIE];
    if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    try {
      const jobId = String(req.query.jobId || '');
      if (jobId) {
        const own = await userOwnsJob(sess.user_id, jobId);
        if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      }
    } catch {}
    const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
    const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    const url = `${env.EVI_BASE_URL}/api/artifacts/compliance${qs}`;
    const r = await fetch(url);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    if (wantsMarkdown(req) && out && typeof out === 'object') {
      try {
        const jobId = String(out?.jobId || req.query.jobId || '');
        const md = renderComplianceMarkdown(jobId, out?.report || out?.compliance || {});
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.status(r.status).send(md);
      } catch {}
    }
    return res.status(r.status).json(out ?? {});
  });
}

// Wrapper: POST audit/byJob (content-negotiated JSON or Markdown)
app.post('/u/proxy/audit/byJob', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const schema = z.object({
    jobId: z.string().min(6),
    model: z.string().min(2).max(128).optional(),
    policy: z.record(z.any()).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  try { const own = await userOwnsJob(sess.user_id, String(parse.data.jobId)); if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } }); } catch {}
  const upstream = `${env.EVI_BASE_URL}/api/audit/byJob`;
  const r = await fetch(upstream, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(parse.data),
  });
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  if (wantsMarkdown(req) && out && out.ok && out.report) {
    try {
      const jobId = String(parse.data.jobId || '');
      const md = renderAuditMarkdown(jobId, out.report);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.status(r.status).send(md);
    } catch {}
  }
  return res.status(r.status).json(out ?? {});
});

// Wrapper: POST compliance/byJob (content-negotiated JSON or Markdown)
app.post('/u/proxy/compliance/byJob', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const schema = z.object({
    jobId: z.string().min(6),
    model: z.string().min(2).max(128).optional(),
    policy: z.record(z.any()).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const upstream = `${env.EVI_BASE_URL}/api/compliance/byJob`;
  const r = await fetch(upstream, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(parse.data),
  });
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  if (wantsMarkdown(req) && out && (out.ok || typeof out.passed !== 'undefined')) {
    try {
      // Upstream may return { ok, compliance: {...} } or { ok, report: {...} }
      const rep = out.compliance || out.report || out;
      const jobId = String(parse.data.jobId || '');
      const md = renderComplianceMarkdown(jobId, rep);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.status(r.status).send(md);
    } catch {}
  }
  return res.status(r.status).json(out ?? {});
});

// Dev-only OTP helper (only when OTP provider is 'dev')
if (String(env.OTP_PROVIDER_MODE) === 'dev' && env.NODE_ENV !== 'production') {
  app.get('/u/dev/otp', async (req: Request, res: Response) => {
    const email = String((req.query.email || '') as string).trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
    try {
      const key = `otp:dev:${email}`;
      const code = await redis.get(key);
      if (!code) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
      return res.json({ ok: true, code, challengeId: key });
    } catch {
      return res.status(500).json({ ok: false, error: { code: 'internal_error' } });
    }
  });
}
// Dev-only Sentry test route
if (env.SENTRY_DSN && env.NODE_ENV !== 'production') {
  app.get('/u/dev/sentry-test', (_req: Request, res: Response) => {
    try {
      throw new Error('sentry_test_error');
    } catch (e) {
      Sentry.captureException(e);
    }
    return res.json({ ok: true, sentry: 'captured' });
  });
}
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    const log = { level: 'info', msg: 'http', method: req.method, url: (req as any).originalUrl || req.url, status: res.statusCode, duration_ms: Date.now() - t, ip: req.ip };
    console.log(JSON.stringify(log));
  });
  next();
});

const OTP_TTL_MINUTES = 10;
const ACCESS_TTL_MINUTES = 90;
const REFRESH_TTL_DAYS = 30;
const ACCESS_COOKIE = 'evium_access';
const REFRESH_COOKIE = 'evium_refresh';
const CSRF_COOKIE = 'evium_csrf';

const crossSiteEnabled = String(env.COOKIES_CROSS_SITE || '').toLowerCase() === '1' || String(env.COOKIES_CROSS_SITE || '').toLowerCase() === 'true';
const cookieDomain = env.COOKIE_DOMAIN ? String(env.COOKIE_DOMAIN) : undefined;

// Dynamic cookie settings based on request origin
function getCookieSettings(req: Request): { sameSite: 'strict' | 'lax' | 'none'; secure: boolean } {
  const origin = req.headers.origin || '';

  // Check if request is from localhost (development)
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

  if (crossSiteEnabled) {
    if (isLocalhost) {
      // For localhost: use Lax (works without HTTPS) but still allow cross-origin
      return { sameSite: 'lax', secure: false };
    }
    // For production cross-site: use None + Secure (requires HTTPS)
    return { sameSite: 'none', secure: true };
  }

  // Default: strict same-site
  return { sameSite: 'strict', secure: env.NODE_ENV !== 'development' };
}

function setCookie(res: Response, req: Request, name: string, value: string, maxAgeSec: number, httpOnly = true) {
  const { sameSite, secure } = getCookieSettings(req);
  res.cookie(name, value, {
    httpOnly,
    secure,
    sameSite,
    path: '/',
    maxAge: maxAgeSec * 1000,
    domain: cookieDomain,
  });
  try {
    const origin = (req.headers as any)?.origin || '';
    const log = { level: 'info', msg: 'cookie.set', name, httpOnly, secure, sameSite, maxAgeSec, domain: cookieDomain || null, origin };
    console.log(JSON.stringify(log));
  } catch {}
}

const metrics = {
  otpSend: 0,
  otpVerify: 0,
  login: 0,
  logout: 0,
  jobsAttach: 0,
  keysMint: 0,
  keysRedeem: 0,
  keysRevoke: 0,
  roleUpgrade: 0,
  roleDowngrade: 0,
  entitlementsUpdate: 0,
};
const METRIC_KEYS: Record<keyof typeof metrics, string> = {
  otpSend: 'metrics:otpSend',
  otpVerify: 'metrics:otpVerify',
  login: 'metrics:login',
  logout: 'metrics:logout',
  jobsAttach: 'metrics:jobsAttach',
  keysMint: 'metrics:keysMint',
  keysRedeem: 'metrics:keysRedeem',
  keysRevoke: 'metrics:keysRevoke',
  roleUpgrade: 'metrics:roleUpgrade',
  roleDowngrade: 'metrics:roleDowngrade',
  entitlementsUpdate: 'metrics:entitlementsUpdate',
};
async function incrMetric(name: keyof typeof metrics) {
  metrics[name]++;
  try { await redis.incr(METRIC_KEYS[name]); } catch {}
}
async function readAllMetrics(): Promise<typeof metrics> {
  try {
    const keys = Object.values(METRIC_KEYS);
    const vals = await redis.mget(keys);
    const out: any = {};
    let i = 0;
    for (const k of Object.keys(METRIC_KEYS) as (keyof typeof metrics)[]) {
      const v = vals?.[i++] ?? '0';
      out[k] = Number(v || 0) || 0;
    }
    return out as typeof metrics;
  } catch {
    return metrics;
  }
}

// Content negotiation for Markdown vs JSON
function wantsMarkdown(req: Request): boolean {
  const q = String(((req.query as any)?.format || (req.query as any)?.fmt || '') as string).toLowerCase();
  if (q === 'md' || q === 'markdown') return true;
  if (q === 'json') return false;
  const accept = String(req.headers['accept'] || '').toLowerCase();
  return accept.includes('text/markdown') || accept.includes('application/markdown') || accept.includes('text/x-markdown');
}

function renderAuditMarkdown(jobId: string, report: any): string {
  const lines: string[] = [];
  const summary = String(report?.summary || '').trim();
  const score = report?.score;
  const severityMax = String(report?.severityMax || '').toUpperCase();
  const findings: any[] = Array.isArray(report?.findings) ? report.findings : [];
  const coverage = report?.coverage || {};
  const sb = report?.scoreBreakdown || {};
  const recs: any[] = Array.isArray(report?.recommendations) ? report.recommendations : [];

  const sevCounts: Record<string, number> = {};
  for (const f of findings) {
    const sev = String(f?.severity || 'info').toLowerCase();
    sevCounts[sev] = (sevCounts[sev] || 0) + 1;
  }

  lines.push(`# Audit Report — Job ${jobId}`);
  if (summary) lines.push('', summary);
  lines.push('', '## Score');
  lines.push(`- **Total**: ${typeof score === 'number' ? `${score}/100` : 'N/A'}`);
  lines.push(`- **Max Severity**: ${severityMax || 'N/A'}`);
  lines.push('', '## Severity Distribution');
  for (const k of ['critical','high','medium','low','warning','info']) {
    if (sevCounts[k]) lines.push(`- **${k}**: ${sevCounts[k]}`);
  }
  lines.push('', '## Coverage');
  for (const [k, v] of Object.entries(coverage)) lines.push(`- **${k}**: ${v as any}`);
  lines.push('', '## Score Breakdown');
  for (const [k, v] of Object.entries(sb)) lines.push(`- **${k}**: ${v as any}`);

  if (findings.length) {
    lines.push('', '## Findings');
    for (const f of findings) {
      const id = f?.id ? String(f.id) : '';
      const title = f?.title ? String(f.title) : '';
      const sev = f?.severity ? String(f.severity).toUpperCase() : 'INFO';
      const category = f?.category ? String(f.category) : '';
      const file = f?.file ? String(f.file) : '';
      const line = typeof f?.line === 'number' ? f.line : undefined;
      const desc = f?.description ? String(f.description) : '';
      const impact = f?.impact ? String(f.impact) : '';
      const likelihood = f?.likelihood ? String(f.likelihood) : '';
      const evidence = f?.evidence;
      const references: any[] = Array.isArray(f?.references) ? f.references : [];
      const remediation = f?.remediation ? String(f.remediation) : '';
      const remediationCode = f?.remediationCode ? String(f.remediationCode) : '';

      lines.push('', `### [${sev}] ${id}${id && title ? ' — ' : ''}${title}`);
      if (category) lines.push(`- **Category**: ${category}`);
      if (file) lines.push(`- **Location**: ${file}${typeof line === 'number' ? `:${line}` : ''}`);
      if (desc) lines.push('- **Description**:', `  ${desc}`);
      if (impact) lines.push(`- **Impact**: ${impact}`);
      if (likelihood) lines.push(`- **Likelihood**: ${likelihood}`);
      if (evidence) lines.push(`- **Evidence**: ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
      if (references.length) {
        lines.push('- **References**:');
        for (const r of references) lines.push(`  - ${String(r)}`);
      }
      if (remediation) lines.push('- **Remediation**:', `  ${remediation}`);
      if (remediationCode) {
        lines.push('', '```diff', remediationCode.trim(), '```');
      }
    }
  }

  if (recs.length) {
    lines.push('', '## Recommendations');
    for (const r of recs) lines.push(`- ${String(r)}`);
  }

  return lines.join('\n');
}

function renderComplianceMarkdown(jobId: string, report: any): string {
  const lines: string[] = [];
  const profile = String(report?.profile || 'generic');
  const version = String(report?.analysisVersion || '');
  const ts = String(report?.timestamp || '');
  const solc = String(report?.solcVersion || '');
  const passed = !!report?.passed;
  const score = report?.score;
  const risk = String(report?.riskLevel || '').toUpperCase();
  const confidence = typeof report?.confidence === 'number' ? report.confidence : undefined;
  const metrics = report?.metrics || {};
  const keyFindings: any[] = Array.isArray(report?.keyFindings) ? report.keyFindings : [];
  const recommendations: any[] = Array.isArray(report?.recommendations) ? report.recommendations : [];
  const quickWins: any[] = Array.isArray(report?.quickWins) ? report.quickWins : [];
  const checks: any[] = Array.isArray(report?.checks) ? report.checks : [];

  let passedCount = 0, failedCount = 0;
  for (const c of checks) { if (c?.passed) passedCount++; else failedCount++; }

  lines.push(`# Compliance Report — Job ${jobId}`);
  lines.push('', '## Overview');
  lines.push(`- **Profile**: ${profile}`);
  if (version) lines.push(`- **Analysis Version**: ${version}`);
  if (ts) lines.push(`- **Timestamp**: ${ts}`);
  if (solc) lines.push(`- **Solc Version**: ${solc}`);
  lines.push(`- **Result**: ${passed ? 'PASSED' : 'FAILED'}`);
  if (typeof score === 'number') lines.push(`- **Score**: ${score}/100`);
  if (risk) lines.push(`- **Risk Level**: ${risk}`);
  if (typeof confidence === 'number') lines.push(`- **Confidence**: ${confidence}`);

  if (Object.keys(metrics).length) {
    lines.push('', '## Metrics');
    for (const [k, v] of Object.entries(metrics)) lines.push(`- **${k}**: ${v as any}`);
  }

  lines.push('', '## Checks Summary');
  lines.push(`- **Passed**: ${passedCount}`);
  lines.push(`- **Failed**: ${failedCount}`);

  if (checks.length) {
    lines.push('', '## Checks');
    for (const c of checks) {
      const id = c?.id ? String(c.id) : '';
      const title = c?.title ? String(c.title) : '';
      const sev = c?.severity ? String(c.severity).toUpperCase() : '';
      const category = c?.category ? String(c.category) : '';
      const status = c?.passed ? 'PASSED' : 'FAILED';
      const ev = c?.evidence || {};
      const reason = ev?.reason ? String(ev.reason) : '';
      const snippet = ev?.snippet ? String(ev.snippet) : '';
      const locations: any[] = Array.isArray(ev?.locations) ? ev.locations : [];
      const rec = c?.recommendation ? String(c.recommendation) : '';
      const complexity = c?.fixComplexity ? String(c.fixComplexity) : '';
      const effort = c?.estimatedEffort ? String(c.estimatedEffort) : '';

      lines.push('', `### [${status}${sev ? ` • ${sev}` : ''}] ${id}${id && title ? ' — ' : ''}${title}`);
      if (category) lines.push(`- **Category**: ${category}`);
      if (reason) lines.push('- **Reason**:', `  ${reason}`);
      if (locations.length) {
        lines.push('- **Locations**:');
        for (const l of locations) {
          const locStr = [l?.contract, l?.function].filter(Boolean).join(' • ');
          const withLine = typeof l?.line === 'number' ? `${locStr} (line ${l.line})` : locStr;
          lines.push(`  - ${withLine || JSON.stringify(l)}`);
        }
      }
      if (snippet) lines.push('', '```solidity', snippet.trim(), '```');
      if (rec) lines.push('- **Recommendation**:', `  ${rec}`);
      if (complexity) lines.push(`- **Fix Complexity**: ${complexity}`);
      if (effort) lines.push(`- **Estimated Effort**: ${effort}`);
    }
  }

  if (keyFindings.length) {
    lines.push('', '## Key Findings');
    for (const k of keyFindings) lines.push(`- ${String(k)}`);
  }
  if (recommendations.length) {
    lines.push('', '## Recommendations');
    for (const r of recommendations) {
      if (r && typeof r === 'object') {
        const pr = r?.priority ? ` (priority: ${String(r.priority)})` : '';
        lines.push(`- ${String(r?.title || '')}${pr}`);
        if (r?.description) lines.push(`  - ${String(r.description)}`);
        const bens: any[] = Array.isArray(r?.benefits) ? r.benefits : [];
        if (bens.length) { lines.push('  - Benefits:'); for (const b of bens) lines.push(`    - ${String(b)}`); }
      } else {
        lines.push(`- ${String(r)}`);
      }
    }
  }
  if (quickWins.length) {
    lines.push('', '## Quick Wins');
    for (const q of quickWins) lines.push(`- ${String(q)}`);
  }

  return lines.join('\n');
}

app.get('/u/metrics', requireAuth, async (_req: Request, res: Response) => {
  const m = await readAllMetrics();
  const users = await countUsers();
  return res.json({ ok: true, metrics: m, users });
});

function clearCookie(res: Response, req: Request, name: string) {
  const { sameSite, secure } = getCookieSettings(req);
  res.cookie(name, '', {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: 0,
    domain: cookieDomain,
  });
  try {
    const origin = (req.headers as any)?.origin || '';
    const log = { level: 'info', msg: 'cookie.clear', name, secure, sameSite, domain: cookieDomain || null, origin };
    console.log(JSON.stringify(log));
  } catch {}
}

// Health
app.get('/u/healthz', async (_req: Request, res: Response) => {
  try {
    // DB init ensures tables exist (idempotent)
    await initSchema();
    const redisOk = await pingRedis();
    return res.json({ ok: true, redis: redisOk });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: { message: e?.message || 'unhealthy' } });
  }
});

// OTP provider selection
const otp: OtpProvider = env.OTP_PROVIDER_MODE === 'dev' ? new DevOtpProvider() : new StatefulOtpProvider();

// Send OTP
app.post('/u/auth/send-otp', async (req: Request, res: Response) => {
  const schema = z.object({
    identity: z.string().email(),
    name: z.string().min(1).max(80),
    captchaToken: z.string().min(10).optional(),
    mode: z.enum(['auto', 'signin', 'signup']).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const identity = parse.data.identity.trim().toLowerCase();
  const displayName = parse.data.name?.trim();
  const modeRaw = String((req.body as any)?.mode || 'auto').toLowerCase();
  const mode = (['auto', 'signin', 'signup'].includes(modeRaw) ? modeRaw : 'auto') as 'auto' | 'signin' | 'signup';

  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.otp.send.request', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), mode, ip })); } catch {}
  const rl1 = await allow(`rl:otp:send:${identity}`, env.RL_OTP_SEND_PER_15M, 15 * 60);
  const rl2 = await allow(`rl:otp:send:ip:${ip}`, env.RL_OTP_SEND_IP_PER_15M, 15 * 60);
  if (!rl1.ok || !rl2.ok) { try { console.log(JSON.stringify({ level: 'warn', msg: 'auth.otp.send.rate_limited', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), ip })); } catch {}; return res.status(429).json({ ok: false, error: { code: 'rate_limited' } }); }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = String(parse.data.captchaToken || '');
    if (!token) return res.status(400).json({ ok: false, error: { code: 'captcha_required' } });
    try {
      const body = new URLSearchParams();
      body.set('secret', env.TURNSTILE_SECRET_KEY);
      body.set('response', token);
      if (ip && ip !== 'unknown') body.set('remoteip', ip);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
      const j: any = await r.json();
      if (!j?.success) return res.status(403).json({ ok: false, error: { code: 'captcha_failed' } });
    } catch (_e) {
      return res.status(400).json({ ok: false, error: { code: 'captcha_error' } });
    }
  }

  // Enforce auth modes based on user existence
  const existing = await getUserByEmail(identity);
  if (mode === 'signin' && !existing) {
    return res.status(404).json({ ok: false, error: { code: 'user_not_found' } });
  }
  if (mode === 'signup' && existing) {
    return res.status(409).json({ ok: false, error: { code: 'user_already_exists' } });
  }

  let challengeId: string | undefined;
  let expiresAt: number | undefined;
  let code: string | undefined;
  try {
    const created = await otp.createChallenge(identity, { name: displayName });
    challengeId = created.challengeId;
    expiresAt = created.expiresAt;
    code = (created as any).otp;
  } catch (_e) {
    return res.status(502).json({ ok: false, error: { code: 'email_delivery_failed' } });
  }

  await incrMetric('otpSend');
  await insertAuditLog({ userId: null, event: 'auth.otp.send', metadata: { identity, ip } });

  // In dev, log OTP to server logs; prod should email via Brevo/rail template
  if (env.OTP_PROVIDER_MODE === 'dev' && code) {
    // eslint-disable-next-line no-console
    console.log(`[DEV OTP] identity=${identity} name=${displayName ?? ''} code=${code} challenge=${challengeId}`);
  }

  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.otp.send.success', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), challengeId, expiresAt })); } catch {}
  return res.json({ ok: true, challengeId, expiresAt });
});

// Verify OTP
app.post('/u/auth/verify', async (req: Request, res: Response) => {
  const schema = z.object({
    identity: z.string().email(),
    otp: z.string().min(4).max(10),
    challengeId: z.string().optional(),
    mode: z.enum(['auto', 'signin', 'signup']).optional(),
    name: z.string().min(1).max(80).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const identity = parse.data.identity.trim().toLowerCase();
  const otpCode = parse.data.otp.trim();
  const challengeId = parse.data.challengeId;
  const modeRaw = String((req.body as any)?.mode || 'auto').toLowerCase();
  const mode = (['auto', 'signin', 'signup'].includes(modeRaw) ? modeRaw : 'auto') as 'auto' | 'signin' | 'signup';
  const nameFromBody = (parse.data.name || '').trim();

  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.verify.request', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), mode, ip })); } catch {}
  const rl = await allow(`rl:otp:verify:${identity}`, env.RL_OTP_VERIFY_PER_15M, 15 * 60);
  if (!rl.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { ok } = await otp.verify(identity, otpCode, challengeId);
  if (!ok) { try { console.log(JSON.stringify({ level: 'warn', msg: 'auth.verify.invalid_otp', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), ip })); } catch {}; return res.status(401).json({ ok: false, error: { code: 'invalid_otp' } }); }

  // Enforce auth modes and create user when needed
  let user = await getUserByEmail(identity);
  if (mode === 'signin' && !user) { try { console.log(JSON.stringify({ level: 'info', msg: 'auth.verify.user_not_found', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), ip })); } catch {}; return res.status(404).json({ ok: false, error: { code: 'user_not_found' } }); }
  if (mode === 'signup' && user) { try { console.log(JSON.stringify({ level: 'info', msg: 'auth.verify.user_already_exists', identity_domain: (identity.includes('@') ? identity.split('@')[1] : ''), ip })); } catch {}; return res.status(409).json({ ok: false, error: { code: 'user_already_exists' } }); }
  if (!user) {
    const created: any = await upsertUserByEmail(identity);
    const full: any = (await getUserById(created.id)) || created;
    if (nameFromBody) {
      try { await updateUserDisplayName(full.id, nameFromBody); } catch {}
      try { full.display_name = nameFromBody; } catch {}
    }
    user = full as typeof user;
  }
  if (!user) return res.status(500).json({ ok: false, error: { code: 'internal_error' } });
  const u = user as any;
  await ensureEntitlements(u.id);

  await incrMetric('otpVerify');
  await insertAuditLog({ userId: u.id, event: 'auth.otp.verify', metadata: { identity } });

  const accessRaw = randomToken(32);
  const refreshRaw = randomToken(32);
  const accessHash = tokenHash(accessRaw);
  const refreshHash = tokenHash(refreshRaw);

  const expiresAt = new Date(Date.now() + ACCESS_TTL_MINUTES * 60_000);
  const ipForSession = getClientIp(req.headers['x-forwarded-for'], req.ip);
  await createSession({ userId: u.id, sessionHash: accessHash, refreshHash, expiresAt, ip: ipForSession, deviceInfo: {} });

  await incrMetric('login');
  await insertAuditLog({ userId: u.id, event: 'auth.login', metadata: {} });

  setCookie(res, req, ACCESS_COOKIE, accessRaw, ACCESS_TTL_MINUTES * 60, true);
  setCookie(res, req, REFRESH_COOKIE, refreshRaw, REFRESH_TTL_DAYS * 24 * 3600, true);
  const csrf = randomToken(16);
  setCookie(res, req, CSRF_COOKIE, csrf, ACCESS_TTL_MINUTES * 60, false);
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.verify.success', user_id: u.id })); } catch {}

  const ent = await getEntitlements(u.id);
  const profile = (u.metadata as any)?.profile || {};
  return res.json({ ok: true, user: { id: u.id, email: u.email, role: u.role, display_name: u.display_name, wallet_address: u.wallet_address, profile }, entitlements: ent, counts: { jobs_today: 0, jobs_total: 0 } });
});

// Logout
app.post('/u/auth/logout', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.logout.request', has_access: !!access })); } catch {}
  if (typeof access === 'string' && access.length) {
    const hash = tokenHash(access);
    const sess = await findValidSessionByHash(hash);
    await revokeSessionByHash(hash);
    if (sess?.user_id) {
      await incrMetric('logout');
      await insertAuditLog({ userId: sess.user_id, event: 'auth.logout', metadata: {} });
    }
  }
  clearCookie(res, req, ACCESS_COOKIE);
  clearCookie(res, req, REFRESH_COOKIE);
  clearCookie(res, req, CSRF_COOKIE);
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.logout.success' })); } catch {}
  return res.json({ ok: true });
});

// Refresh access token using refresh cookie; rotates both tokens
app.post('/u/auth/refresh', async (req: Request, res: Response) => {
  const refresh = req.cookies?.[REFRESH_COOKIE];
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.refresh.request', has_refresh: !!refresh })); } catch {}
  if (!refresh || typeof refresh !== 'string') { try { console.log(JSON.stringify({ level: 'warn', msg: 'auth.refresh.unauthorized', reason: 'no_refresh_cookie' })); } catch {}; return res.status(401).json({ ok: false, error: { code: 'unauthorized' } }); }
  const refreshHash = tokenHash(refresh);
  try {
    const sess = await findSessionByRefreshHash(refreshHash);
    if (!sess) { try { console.log(JSON.stringify({ level: 'warn', msg: 'auth.refresh.unauthorized', reason: 'invalid_refresh' })); } catch {}; return res.status(401).json({ ok: false, error: { code: 'unauthorized' } }); }
    const accessRaw = randomToken(32);
    const newAccessHash = tokenHash(accessRaw);
    const refreshRaw = randomToken(32);
    const newRefreshHash = tokenHash(refreshRaw);
    const newExpiresAt = new Date(Date.now() + ACCESS_TTL_MINUTES * 60_000);
    await updateSessionTokens({ sessionId: sess.id, newAccessHash, newRefreshHash, newExpiresAt });

    setCookie(res, req, ACCESS_COOKIE, accessRaw, ACCESS_TTL_MINUTES * 60, true);
    setCookie(res, req, REFRESH_COOKIE, refreshRaw, REFRESH_TTL_DAYS * 24 * 3600, true);
    const csrf = randomToken(16);
    setCookie(res, req, CSRF_COOKIE, csrf, ACCESS_TTL_MINUTES * 60, false);
    await insertAuditLog({ userId: sess.user_id, event: 'auth.refresh', metadata: {} });
    try { console.log(JSON.stringify({ level: 'info', msg: 'auth.refresh.success', user_id: sess.user_id })); } catch {}
    return res.json({ ok: true });
  } catch (err: any) {
    try { console.log(JSON.stringify({ level: 'error', msg: 'auth.refresh.error', error: err?.message || String(err) })); } catch {}
    return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
  }
});

// Me
app.get('/u/user/me', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  try { console.log(JSON.stringify({ level: 'info', msg: 'auth.me.request', has_access: !!access })); } catch {}
  if (!access) { try { console.log(JSON.stringify({ level: 'warn', msg: 'auth.me.unauthorized', reason: 'no_access_cookie' })); } catch {}; return res.status(401).json({ ok: false, error: { code: 'unauthorized' } }); }
  const hash = tokenHash(String(access));
  try {
    const sess = await findValidSessionByHash(hash);
    if (!sess) { try { console.log(JSON.stringify({ level: 'warn', msg: 'auth.me.unauthorized', reason: 'invalid_session' })); } catch {}; return res.status(401).json({ ok: false, error: { code: 'unauthorized' } }); }

    const userId = sess.user_id;
    const user = await getUserById(userId);
    const ent = await getEntitlements(userId);
    const sum = await countUserJobsSummary(userId).catch(() => ({ today: 0, total: 0 }));
    const counts = { jobs_today: sum.today, jobs_total: sum.total };
    if (user) {
      const profile = (user.metadata as any)?.profile || {};
      try { console.log(JSON.stringify({ level: 'info', msg: 'auth.me.success', user_id: user.id })); } catch {}
      return res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name, wallet_address: user.wallet_address, profile }, entitlements: ent, counts });
    }
    try { console.log(JSON.stringify({ level: 'info', msg: 'auth.me.success', user_id: userId })); } catch {}
    return res.json({ ok: true, user: { id: userId }, entitlements: ent, counts });
  } catch (err: any) {
    try { console.log(JSON.stringify({ level: 'error', msg: 'auth.me.error', error: err?.message || String(err) })); } catch {}
    return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
  }
});

// Update profile (display_name)
app.post('/u/user/profile', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const schema = z.object({
    display_name: z.string().min(1).max(80),
    wallet_address: z.string().min(1).max(256).nullable().optional(),
    profile: z.object({
      organization: z.string().min(1).max(120),
      role: z.string().min(1).max(120),
      location: z.string().max(120).optional(),
      country: z.string().max(80).optional(),
      state: z.string().max(80).optional(),
      city: z.string().max(120).optional(),
      avatar_url: z.string().url().max(1024).optional(),
      bio: z.string().max(1000).optional(),
      phone: z.string().max(50).optional(),
      birthday: z.string().max(40).optional(),
      gender: z.string().max(40).optional(),
      social: z.object({
        github: z.string().max(200).optional(),
        linkedin: z.string().max(200).optional(),
        twitter: z.string().max(200).optional(),
        telegram: z.string().max(200).optional(),
      }).partial().optional(),
    }),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const userId = (req as any).auth.userId as string;
  const u = await updateUserProfile(userId, {
    display_name: parse.data.display_name,
    wallet_address: parse.data.wallet_address,
    profile: parse.data.profile,
  });
  const ent = await getEntitlements(userId);
  await insertAuditLog({ userId, event: 'user.profile.update', metadata: { changed: Object.keys(req.body || {}) } });
  const profile = (u?.metadata as any)?.profile || {};
  return res.json({ ok: true, user: u ? { id: u.id, email: u.email, role: u.role, display_name: u.display_name, wallet_address: u.wallet_address, profile } : undefined, entitlements: ent });
});

app.post('/u/user/avatar', requireAuth, express.raw({ type: '*/*', limit: '6mb' }), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(ct)) return res.status(415).json({ ok: false, error: { code: 'unsupported_media_type', detail: 'Use image/png, image/jpeg, or image/webp' } });
  const body = req.body as any;
  if (!body || !(body instanceof Buffer) || body.length === 0) return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: 'Missing image body' } });
  if (body.length > 6 * 1024 * 1024) return res.status(413).json({ ok: false, error: { code: 'payload_too_large' } });

  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:avatar:upload:user:${userId}`, 30, 15 * 60);
  const rlI = await allow(`rl:avatar:upload:ip:${ip}`, 200, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const rec = await insertUserAvatar({ userId, contentType: ct, bytes: body as Buffer });
  const url = `/u/user/avatar/${rec.id}`;
  try { await updateUserProfile(userId, { profile: { avatar_url: url } }); } catch {}
  await insertAuditLog({ userId, event: 'user.avatar.upload', metadata: { id: rec.id, content_type: ct, size: body.length } });
  return res.json({ ok: true, avatar: { id: rec.id, url } });
});

app.get('/u/user/avatar/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!id) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });

  // Support multiple response formats via query param: ?format=base64|json|binary (default: binary)
  const format = String(req.query.format || 'binary').toLowerCase();

  try {
    const row = await getUserAvatarById(id);
    if (!row) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

    // Normalize bytes from various PostgreSQL return formats
    let bytes: Buffer;
    if (Buffer.isBuffer(row.bytes)) {
      bytes = row.bytes;
    } else if (row.bytes && typeof row.bytes === 'object' && (row.bytes as any).type === 'Buffer' && Array.isArray((row.bytes as any).data)) {
      // Handle serialized Buffer format { type: 'Buffer', data: [...] }
      bytes = Buffer.from((row.bytes as any).data);
    } else if (typeof row.bytes === 'string') {
      // Handle base64 encoded string
      bytes = Buffer.from(row.bytes, 'base64');
    } else if (row.bytes && typeof row.bytes === 'object' && ArrayBuffer.isView(row.bytes)) {
      // Handle Uint8Array or other typed arrays
      bytes = Buffer.from(row.bytes as any);
    } else {
      console.log(JSON.stringify({ level: 'error', msg: 'avatar.invalid_bytes', id, bytesType: typeof row.bytes, hasData: !!row.bytes }));
      return res.status(500).json({ ok: false, error: { code: 'internal_error', detail: 'Invalid image data format' } });
    }

    const contentType = row.content_type || 'image/png';

    // Set CORS headers for all formats
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Return based on requested format
    if (format === 'base64') {
      // Return base64 data URL - useful for direct embedding in img src
      const base64 = bytes.toString('base64');
      const dataUrl = `data:${contentType};base64,${base64}`;
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(dataUrl);
    }

    if (format === 'json') {
      // Return JSON with base64 data and metadata - useful for API consumers
      const base64 = bytes.toString('base64');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).json({
        ok: true,
        avatar: {
          id,
          content_type: contentType,
          size: bytes.length,
          data_url: `data:${contentType};base64,${base64}`,
          base64,
        },
      });
    }

    // Default: binary format - return raw image bytes
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Content-Length', bytes.length);
    // Add Content-Disposition for better browser handling
    res.setHeader('Content-Disposition', `inline; filename="avatar-${id}.${contentType.split('/')[1] || 'png'}"`);
    return res.status(200).send(bytes);
  } catch (err: any) {
    const msg = String(err?.message || String(err));
    const isDbTimeout = msg.toLowerCase().includes('connection timeout') || msg.includes('Connection terminated') || err?.code === 'ETIMEDOUT';
    console.log(JSON.stringify({ level: 'error', msg: 'avatar.get.error', id, error: msg, code: err?.code || null }));
    if (isDbTimeout) return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
    return res.status(500).json({ ok: false, error: { code: 'internal_error' } });
  }
});

app.delete('/u/user/avatar/:id', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const row = await getUserAvatarById(id);
  if (!row || row.user_id !== userId) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  const count = await deleteUserAvatar(id, userId);
  try {
    const me = await getUserById(userId);
    const cur = (me?.metadata as any) || {};
    const profile = cur.profile || {};
    const url = `/u/user/avatar/${id}`;
    if (profile.avatar_url === url) {
      await updateUserProfile(userId, { profile: { avatar_url: null } as any });
    }
  } catch {}
  await insertAuditLog({ userId, event: 'user.avatar.delete', metadata: { id } });
  return res.json({ ok: true, deleted: count });
});

// List user's avatars (metadata only, no bytes)
app.get('/u/user/avatars', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 50);
  try {
    const avatars = await listUserAvatars(userId, limit);
    const list = avatars.map(a => ({
      id: a.id,
      url: `/u/user/avatar/${a.id}`,
      content_type: a.content_type,
      size: a.size,
      created_at: a.created_at,
    }));
    return res.json({ ok: true, avatars: list });
  } catch (err: any) {
    console.log(JSON.stringify({ level: 'error', msg: 'avatars.list.error', userId, error: err?.message || String(err) }));
    return res.status(500).json({ ok: false, error: { code: 'internal_error' } });
  }
});

app.post('/u/user/avatar/prune', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const schema = z.object({ keepLatest: z.coerce.number().min(1).max(20).default(3) });
  const parse = schema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const keepLatest = parse.data.keepLatest;
  const me = await getUserById(userId);
  const profile = ((me?.metadata as any) || {}).profile || {};
  const currentUrl: string | undefined = typeof profile.avatar_url === 'string' ? profile.avatar_url : undefined;
  const currentId = currentUrl?.startsWith('/u/user/avatar/') ? currentUrl.split('/').pop() : undefined;
  const deleted = await pruneUserAvatars(userId, keepLatest);
  if (currentId) {
    const still = await getUserAvatarById(currentId);
    if (!still) {
      try { await updateUserProfile(userId, { profile: { avatar_url: null } as any }); } catch {}
    }
  }
  await insertAuditLog({ userId, event: 'user.avatar.prune', metadata: { keepLatest, deleted } });
  return res.json({ ok: true, deleted, kept: keepLatest });
});

app.post('/u/jobs/attach', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const schema = z.object({
    jobId: z.string().min(6),
    type: z.string().min(1).max(32).optional(),
    prompt: z.string().max(2000).optional(),
    filename: z.string().max(256).optional(),
    network: z.string().min(2).max(64),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const r = await attachUserJob({
    jobId: parse.data.jobId,
    userId: sess.user_id,
    type: parse.data.type,
    prompt: parse.data.prompt ?? null,
    filename: parse.data.filename ?? null,
    network: parse.data.network,
  });
  await incrMetric('jobsAttach');
  await insertAuditLog({ userId: sess.user_id, event: 'jobs.attach', metadata: { jobId: r.job_id, type: r.type, network: r.network } });
  return res.json({ ok: true, job: r });
});

app.get('/u/jobs', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  let sess: any = null;
  try {
    sess = await findValidSessionByHash(tokenHash(String(access)));
  } catch (err: any) {
    try { console.log(JSON.stringify({ level: 'error', msg: 'jobs.list.error', error: err?.message || String(err) })); } catch {}
    return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
  }
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const schema = z.object({
    type: z.string().optional(),
    state: z.string().optional(),
    network: z.string().optional(),
    q: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().optional(),
  });
  const parse = schema.safeParse(req.query);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const cursor = parse.data.cursorCreatedAt && parse.data.cursorId ? { created_at: new Date(parse.data.cursorCreatedAt), job_id: parse.data.cursorId } : undefined;
  let rows: any[] = [];
  try {
    rows = await listUserJobs(
      sess.user_id,
      { type: parse.data.type, limit: parse.data.limit, state: parse.data.state, network: parse.data.network, q: parse.data.q, cursor } as any
    );
  } catch (err: any) {
    try { console.log(JSON.stringify({ level: 'error', msg: 'jobs.list.error', userId: sess?.user_id, error: err?.message || String(err) })); } catch {}
    return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
  }
  let nextCursor: any = null;
  const lim = Math.min(Math.max(parse.data.limit ?? 20, 1), 100);
  if (rows.length === lim) {
    const last = rows[rows.length - 1] as any;
    nextCursor = { created_at: (last?.created_at instanceof Date ? last.created_at.toISOString() : String(last?.created_at || '')), job_id: String(last?.job_id || '') };
  }
  return res.json({ ok: true, jobs: rows, nextCursor });
});

app.get('/u/jobs/:jobId', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const row = await getUserJobWithCache(sess.user_id, jobId);
  if (!row) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  return res.json({ ok: true, job: row });
});

// Update job metadata
app.patch('/u/jobs/:jobId/meta', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const { jobId } = req.params;
  const own = await userOwnsJob(userId, jobId).catch(() => false);
  if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  const schema = z.object({ title: z.string().max(200).nullable().optional(), description: z.string().max(2000).nullable().optional(), tags: z.array(z.string().max(40)).nullable().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const ok = await updateJobMeta(userId, jobId, parse.data as any);
  if (!ok) return res.status(500).json({ ok: false });
  await insertAuditLog({ userId, event: 'jobs.meta.update', metadata: { jobId, changed: Object.keys(req.body || {}) } });
  const row = await getUserJobWithCache(userId, jobId);
  return res.json({ ok: true, job: row });
});

// Soft-delete job
app.delete('/u/jobs/:jobId', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const { jobId } = req.params;
  const own = await userOwnsJob(userId, jobId).catch(() => false);
  if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  const ok = await softDeleteUserJob(userId, jobId);
  await insertAuditLog({ userId, event: 'jobs.delete', metadata: { jobId, ok } });
  return res.json({ ok: true });
});

// Export bundle (JSON)
app.get('/u/jobs/:jobId/export', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const { jobId } = req.params;
  const own = await userOwnsJob(userId, jobId).catch(() => false);
  if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  const job = await getUserJobWithCache(userId, jobId);
  const artifactsUrl = `${env.EVI_BASE_URL}/api/artifacts?jobId=${encodeURIComponent(jobId)}`;
  const detailUrl = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(jobId)}`;
  const logsUrl = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(jobId)}/logs?afterIndex=0`;
  let artifacts: any = null, detail: any = null, logs: any = null;
  try { const r = await fetch(artifactsUrl); artifacts = await r.json().catch(() => null); } catch {}
  try { const r = await fetch(detailUrl); detail = await r.json().catch(() => null); } catch {}
  try { const r = await fetch(logsUrl); logs = await r.json().catch(() => null); } catch {}
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json({ ok: true, job, artifacts, detail, logs });
});

// User audit logs
app.get('/u/audit/logs', requireAuth, async (req: Request, res: Response) => {
  const schema = z.object({ limit: z.coerce.number().min(1).max(200).optional() });
  const parse = schema.safeParse(req.query);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const userId = (req as any).auth.userId as string;
  const rows = await listUserAuditLogs(userId, parse.data.limit);
  return res.json({ ok: true, logs: rows });
});

// Phase 1: Premium Keys (admin + user)
app.post('/u/admin/keys/mint', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const schema = z.object({ expiresAt: z.string().datetime().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const expiresAt = parse.data.expiresAt ? new Date(parse.data.expiresAt) : null;
  const userId = (req as any).auth.userId as string;
  // Admin rate limits for minting keys
  const ipMint = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlMintU = await allow(`rl:admin:keys:mint:user:${userId}`, env.RL_ADMIN_KEYS_MINT_USER_PER_15M, 15 * 60);
  const rlMintI = await allow(`rl:admin:keys:mint:ip:${ipMint}`, env.RL_ADMIN_KEYS_MINT_IP_PER_15M, 15 * 60);
  if (!rlMintU.ok || !rlMintI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const { id, key } = await createPremiumKey({ issuedByAdmin: userId, expiresAt });
  await incrMetric('keysMint');
  await insertAuditLog({ userId, event: 'key.mint', metadata: { id, expiresAt } });
  return res.json({ ok: true, id, key, expiresAt });
});

app.get('/u/admin/keys', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const schema = z.object({ status: z.enum(['minted','redeemed','revoked']).optional(), limit: z.coerce.number().min(1).max(200).optional() });
  const parse = schema.safeParse(req.query);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const rows = await listPremiumKeys({ status: parse.data.status as any, limit: parse.data.limit });
  return res.json({ ok: true, keys: rows });
});

app.get('/u/admin/keys/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const okId = z.string().uuid().safeParse(id);
  if (!okId.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const row = await findPremiumKeyById(id);
  if (!row) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  const { secret_hash, ...safe } = row as any;
  return res.json({ ok: true, key: safe });
});

app.post('/u/admin/keys/revoke', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const schema = z.object({ id: z.string().uuid() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  // Admin rate limits for revoke
  const userId = (req as any).auth.userId as string;
  const ipRevoke = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlRevokeU = await allow(`rl:admin:keys:revoke:user:${userId}`, env.RL_ADMIN_KEYS_REVOKE_USER_PER_15M, 15 * 60);
  const rlRevokeI = await allow(`rl:admin:keys:revoke:ip:${ipRevoke}`, env.RL_ADMIN_KEYS_REVOKE_IP_PER_15M, 15 * 60);
  if (!rlRevokeU.ok || !rlRevokeI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  await updatePremiumKeyStatus(parse.data.id, 'revoked');
  await incrMetric('keysRevoke');
  await insertAuditLog({ userId, event: 'key.revoke', metadata: { id: parse.data.id } });
  return res.json({ ok: true });
});

// User: redeem premium key
app.post('/u/keys/redeem', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:keys:redeem:user:${userId}`, env.RL_KEYS_REDEEM_PER_15M, 15 * 60);
  const rlI = await allow(`rl:keys:redeem:ip:${ip}`, env.RL_KEYS_REDEEM_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const schema = z.object({ key: z.string().min(10).max(256) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const key = String(parse.data.key || '').trim();
  const lookup = tokenHash(key);
  try {
    const out = await redeemPremiumKeyAndGrantPro({ lookupHash: lookup, userId });
    if (!out.ok) {
      if (out.code === 'invalid_key') return res.status(400).json({ ok: false, error: { code: 'invalid_key' } });
      if (out.code === 'already_used') return res.status(409).json({ ok: false, error: { code: 'already_used' } });
      return res.status(400).json({ ok: false, error: { code: 'invalid_key' } });
    }
    await incrMetric('keysRedeem');
    await insertAuditLog({ userId, event: 'key.redeem', metadata: { id: out.keyId } });
    await insertAuditLog({ userId, event: 'entitlements.update', metadata: { pro_enabled: true } });
    const ent = await getEntitlements(userId);
    return res.json({ ok: true, entitlements: ent });
  } catch (err: any) {
    const msg = String(err?.message || String(err));
    console.error(JSON.stringify({ level: 'error', msg: 'keys.redeem.error', userId, ip, error: msg, code: err?.code || null }));
    return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
  }
});

// Admin: list active users (require admin)
app.get('/u/admin/users/active', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const schema = z.object({ limit: z.coerce.number().min(1).max(1000).optional() });
  const parse = schema.safeParse(req.query);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const rows = await listActiveUsers(parse.data.limit);
  return res.json({ ok: true, users: rows.map(r => ({ id: r.id, email: r.email, role: r.role, display_name: r.display_name, last_seen_at: r.last_seen_at })) });
});

// Admin: lookup user by id or email
app.get('/u/admin/user/lookup', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const adminId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:admin:lookup:user:${adminId}`, env.RL_ADMIN_LOOKUP_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:admin:lookup:ip:${ip}`, env.RL_ADMIN_LOOKUP_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const idSan = typeof req.query.id === 'string' ? (req.query.id as string).trim() : undefined;
  const emailSan = typeof req.query.email === 'string' ? (req.query.email as string).trim().toLowerCase() : undefined;
  const schema = z.object({ id: z.string().uuid().optional(), email: z.string().email().optional() });
  const parsed = schema.safeParse({ id: idSan, email: emailSan });
  if (!parsed.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const { id, email } = parsed.data as any;
  if ((!id && !email) || (id && email)) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });

  const target = id ? await getUserById(id) : await getUserByEmail(email);
  if (!target) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  const ent = await getEntitlements(target.id);
  const sum = await countUserJobsSummary(target.id).catch(() => ({ today: 0, total: 0 }));
  const profile = (target.metadata as any)?.profile || {};
  return res.json({ ok: true, user: { id: target.id, email: target.email, role: target.role, display_name: target.display_name, wallet_address: target.wallet_address, profile }, entitlements: ent, counts: { jobs_today: sum.today, jobs_total: sum.total } });
});

app.get('/u/admin/users/:userId/jobs', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const adminId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:admin:lookup:user:${adminId}`, env.RL_ADMIN_LOOKUP_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:admin:lookup:ip:${ip}`, env.RL_ADMIN_LOOKUP_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { userId } = req.params;
  const okId = z.string().uuid().safeParse(userId);
  if (!okId.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });

  const schema = z.object({
    type: z.string().optional(),
    state: z.string().optional(),
    network: z.string().optional(),
    q: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().optional(),
  });
  const parse = schema.safeParse(req.query);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });

  const cursor = parse.data.cursorCreatedAt && parse.data.cursorId ? { created_at: new Date(parse.data.cursorCreatedAt), job_id: parse.data.cursorId } : undefined;
  const rows = await listUserJobs(okId.data, { type: parse.data.type, limit: parse.data.limit, state: parse.data.state, network: parse.data.network, q: parse.data.q, cursor } as any);

  let nextCursor: any = null;
  const lim = Math.min(Math.max(parse.data.limit ?? 20, 1), 100);
  if (rows.length === lim) {
    const last = rows[rows.length - 1] as any;
    nextCursor = { created_at: (last?.created_at instanceof Date ? last.created_at.toISOString() : String(last?.created_at || '')), job_id: String(last?.job_id || '') };
  }

  return res.json({ ok: true, jobs: rows, nextCursor });
});

app.get('/u/admin/users/:userId/jobs/:jobId', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const adminId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:admin:lookup:user:${adminId}`, env.RL_ADMIN_LOOKUP_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:admin:lookup:ip:${ip}`, env.RL_ADMIN_LOOKUP_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { userId, jobId } = req.params;
  const okId = z.string().uuid().safeParse(userId);
  if (!okId.success || !jobId) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const row = await getUserJobWithCache(okId.data, jobId);
  if (!row) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  return res.json({ ok: true, job: row });
});

app.get('/u/admin/jobs/:jobId/upstream', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const adminId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:admin:lookup:user:${adminId}`, env.RL_ADMIN_LOOKUP_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:admin:lookup:ip:${ip}`, env.RL_ADMIN_LOOKUP_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(jobId)}${qs}`;
  let r: any;
  try { r = await fetch(url); } catch (e: any) { return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable' } }); }
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  return res.status(r.status).json(out ?? {});
});

app.get('/u/admin/jobs/:jobId/artifacts', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const adminId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:admin:lookup:user:${adminId}`, env.RL_ADMIN_LOOKUP_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:admin:lookup:ip:${ip}`, env.RL_ADMIN_LOOKUP_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const url = `${env.EVI_BASE_URL}/api/artifacts?jobId=${encodeURIComponent(jobId)}`;
  let r: any;
  try { r = await fetch(url); } catch (e: any) { return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable' } }); }
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  return res.status(r.status).json(out ?? {});
});

// Admin: update user entitlements directly (toggle flags)
app.post('/u/admin/users/entitlements', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const schema = z.object({
    id: z.string().uuid().optional(),
    email: z.string().email().optional(),
    pro_enabled: z.boolean().optional(),
    wallet_deployments: z.boolean().optional(),
    history_export: z.boolean().optional(),
    chat_agents: z.boolean().optional(),
    hosted_frontend: z.boolean().optional(),
    limits: z.record(z.any()).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const { id, email, ...flags } = parse.data as any;
  if ((!id && !email) || (id && email)) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  // Admin rate limits for entitlement updates
  const adminId = (req as any).auth.userId as string;
  const ipEnt = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlEntU = await allow(`rl:admin:entitlements:user:${adminId}`, env.RL_ADMIN_ENTITLEMENTS_USER_PER_15M, 15 * 60);
  const rlEntI = await allow(`rl:admin:entitlements:ip:${ipEnt}`, env.RL_ADMIN_ENTITLEMENTS_IP_PER_15M, 15 * 60);
  if (!rlEntU.ok || !rlEntI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const target = email ? await getUserByEmail(email.toLowerCase()) : await getUserById(id);
  if (!target) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  await setUserRoleAndEntitlements(target.id, flags);
  await incrMetric('entitlementsUpdate');
  await insertAuditLog({ userId: adminId, event: 'entitlements.update', metadata: { target: target.id, ...flags } });
  const ent = await getEntitlements(target.id);
  const profile = (target.metadata as any)?.profile || {};
  return res.json({ ok: true, user: { id: target.id, email: target.email, role: target.role, display_name: target.display_name, wallet_address: target.wallet_address, profile }, entitlements: ent });
});

app.post('/u/admin/users/downgrade', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const schema = z.object({ id: z.string().uuid().optional(), email: z.string().email().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const { id, email } = parse.data as any;
  if ((!id && !email) || (id && email)) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  let user = undefined as Awaited<ReturnType<typeof getUserById>> | undefined;
  if (email) user = await getUserByEmail(email.toLowerCase());
  if (id) user = await getUserById(id);
  if (!user) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  // Admin rate limits for downgrade
  const adminId = (req as any).auth.userId as string;
  const ipDown = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlDownU = await allow(`rl:admin:downgrade:user:${adminId}`, env.RL_ADMIN_DOWNGRADE_USER_PER_15M, 15 * 60);
  const rlDownI = await allow(`rl:admin:downgrade:ip:${ipDown}`, env.RL_ADMIN_DOWNGRADE_IP_PER_15M, 15 * 60);
  if (!rlDownU.ok || !rlDownI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const u = user as any;
  await setUserRoleAndEntitlements(u.id, {
    role: 'normal',
    pro_enabled: false,
    wallet_deployments: false,
    history_export: false,
    chat_agents: false,
    hosted_frontend: false,
  });
  await incrMetric('roleDowngrade');
  await incrMetric('entitlementsUpdate');
  await insertAuditLog({ userId: adminId, event: 'role.downgrade', metadata: { target: u.id } });
  await insertAuditLog({ userId: adminId, event: 'entitlements.update', metadata: { target: u.id, pro_enabled: false } });
  const ent = await getEntitlements(u.id);
  return res.json({ ok: true, user: { ...u, role: 'normal' }, entitlements: ent });
});

app.post('/u/jobs/cache', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const schema = z.object({
    jobId: z.string().min(6),
    state: z.string().min(2),
    progress: z.number().min(0).max(100).optional(),
    address: z.string().optional(),
    fq_name: z.string().optional(),
    constructor_args: z.array(z.any()).optional(),
    verified: z.boolean().optional(),
    explorer_url: z.string().url().optional(),
    completed_at: z.coerce.date().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  await upsertJobCache({
    jobId: parse.data.jobId,
    state: parse.data.state,
    progress: parse.data.progress,
    address: parse.data.address ?? null,
    fq_name: parse.data.fq_name ?? null,
    constructor_args: parse.data.constructor_args,
    verified: parse.data.verified,
    explorer_url: parse.data.explorer_url ?? null,
    completed_at: parse.data.completed_at ?? null,
  });
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Builder Proxy: Frontend_Builder Wrapper Endpoints
// ─────────────────────────────────────────────────────────────────────────────

function toBuilderUrl(path: string) {
  const base = String(env.FRONTEND_BUILDER_BASE_URL || '').replace(/\/+$/, '');
  const p = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return `${base}${p}`;
}

async function builderFetchJson(url: string, opts?: { method?: string; body?: any; headers?: Record<string, string>; timeoutMs?: number }) {
  const method = opts?.method || 'GET';
  const timeoutMs = Number(opts?.timeoutMs || 60000);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(opts?.body ? { 'content-type': 'application/json' } : {}),
        ...(opts?.headers || {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    let out: any = null;
    try { out = await r.json(); } catch { out = null; }
    return { status: r.status, ok: r.ok, body: out };
  } finally {
    clearTimeout(t);
  }
}

// Create builder project
app.post('/u/proxy/builder/projects', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:create:user:${userId}`, env.RL_BUILDER_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:create:ip:${ip}`, env.RL_BUILDER_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const schema = z.object({
    prompt: z.string().min(4).max(20000),
    model: z.string().min(2).max(128).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });

  const upstream = toBuilderUrl('/chat');
  let r: any;
  try {
    r = await builderFetchJson(upstream, { method: 'POST', body: parse.data, timeoutMs: 180000 });
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message || 'upstream unreachable' } });
  }
  if (!r.ok) return res.status(r.status).json(r.body ?? { ok: false });

  const fbProjectId = String(r.body?.chat_id || r.body?.id || '');
  if (!fbProjectId) return res.status(502).json({ ok: false, error: { code: 'upstream_bad_response' } });

  const mapping = await createBuilderProjectMapping(userId, fbProjectId, String(parse.data.prompt || '').slice(0, 100));
  await insertAuditLog({ userId, event: 'builder.create', metadata: { id: mapping.id, fb_project_id: fbProjectId } });
  return res.json({ ok: true, project: mapping, upstream: r.body });
});

// List builder projects (central index)
app.get('/u/proxy/builder/projects', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const limit = Number(req.query.limit || 50);
  const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
  const projectType = String(req.query.type || '').trim() || undefined;
  const projects = await listBuilderProjects(userId, limit, projectType);

  // Optional: refresh status for a small subset (avoid N+1 blowups)
  if (refresh) {
    const slice = projects.slice(0, 10);
    for (const p of slice) {
      try {
        const st = await builderFetchJson(toBuilderUrl(`/chats/${encodeURIComponent(p.fb_project_id)}/build-status`), { timeoutMs: 30000 });
        if (st.ok && st.body) {
          const status = String(st.body?.build_status || st.body?.status || '').trim() || null;
          if (status && status !== p.status) {
            await updateBuilderProjectCache(p.id, { status });
            (p as any).status = status;
          }
        }
      } catch {}
    }
  }

  return res.json({ ok: true, projects });
});

// Builder project detail
app.get('/u/proxy/builder/projects/:id', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const includeMessages = ['1', 'true', 'yes'].includes(String(req.query.includeMessages || '').toLowerCase());
  let messages: any = null;
  if (includeMessages) {
    try {
      const r = await builderFetchJson(toBuilderUrl(`/chats/${encodeURIComponent(proj.fb_project_id)}/messages`), { timeoutMs: 60000 });
      if (r.ok) messages = r.body;
      // If chat metadata includes URLs, opportunistically cache
      const vercelUrl = String(r.body?.chat?.vercel_url || '').trim();
      const githubUrl = String(r.body?.chat?.github_repo_url || r.body?.chat?.github_url || '').trim();
      if (vercelUrl || githubUrl) {
        await updateBuilderProjectCache(proj.id, { vercel_url: vercelUrl || undefined, github_url: githubUrl || undefined });
        (proj as any).vercel_url = vercelUrl || proj.vercel_url;
        (proj as any).github_url = githubUrl || proj.github_url;
      }
    } catch {}
  }

  return res.json({ ok: true, project: proj, messages });
});

// Builder project: update cached metadata (title/status/urls/contract fields)
app.patch('/u/proxy/builder/projects/:id', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden', message: 'CSRF token mismatch' } });
  const userId = (req as any).auth.userId as string;
  const id = String(req.params.id || '').trim();
  const okId = z.string().uuid().safeParse(id);
  if (!okId.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Invalid project id' } });

  const proj = await getBuilderProjectById(userId, id);
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const schema = z.object({
    title: z.string().max(200).nullable().optional(),
    status: z.string().max(80).nullable().optional(),
    vercel_url: z.string().max(500).nullable().optional(),
    github_url: z.string().max(500).nullable().optional(),
    project_type: z.string().max(40).optional(),
    contract_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed Ethereum address').nullable().optional(),
    contract_network: z.string().max(64).nullable().optional(),
    contract_chain_id: z.number().int().min(1).max(10_000_000).nullable().optional(),
    contract_explorer_url: z.string().max(500).nullable().optional(),
    contract_verified: z.boolean().optional(),
    contract_job_id: z.string().max(128).nullable().optional(),
    contract_name: z.string().max(128).nullable().optional(),
    contract_abi: z.any().nullable().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });

  const ok = await updateBuilderProjectCache(id, parse.data as any);
  await insertAuditLog({ userId, event: 'builder.project.update', metadata: { id, changed: Object.keys(req.body || {}) } });
  if (!ok) return res.status(500).json({ ok: false, error: { code: 'internal_error' } });
  const updated = await getBuilderProjectById(userId, id);
  return res.json({ ok: true, project: updated });
});

// Builder project: delete mapping (soft delete)
app.delete('/u/proxy/builder/projects/:id', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden', message: 'CSRF token mismatch' } });
  const userId = (req as any).auth.userId as string;
  const id = String(req.params.id || '').trim();
  const okId = z.string().uuid().safeParse(id);
  if (!okId.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Invalid project id' } });
  const ok = await softDeleteBuilderProject(userId, id);
  await insertAuditLog({ userId, event: 'builder.project.delete', metadata: { id, ok } });
  if (!ok) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  return res.json({ ok: true });
});

// Builder project status
app.get('/u/proxy/builder/projects/:id/status', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const upstream = toBuilderUrl(`/chats/${encodeURIComponent(proj.fb_project_id)}/build-status`);
  let out: any;
  try {
    const r = await builderFetchJson(upstream, { timeoutMs: 60000 });
    if (!r.ok) return res.status(r.status).json(r.body ?? { ok: false });
    out = r.body;
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message || 'upstream unreachable' } });
  }

  const status = String(out?.build_status || out?.status || '').trim() || null;
  if (status) {
    await updateBuilderProjectCache(proj.id, { status });
    (proj as any).status = status;
  }

  return res.json({ ok: true, project: proj, status: out });
});

// Builder files list
app.get('/u/proxy/builder/projects/:id/files', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const upstream = toBuilderUrl(`/projects/${encodeURIComponent(proj.fb_project_id)}/files`);
  try {
    const r = await builderFetchJson(upstream, { timeoutMs: 60000 });
    return res.status(r.status).json(r.body ?? {});
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message || 'upstream unreachable' } });
  }
});

// Builder file content: query-param path (avoids Express wildcard routing issues)
app.get('/u/proxy/builder/projects/:id/file', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const path = String(req.query.path || '').trim();
  if (!path) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'path is required' } });

  const upstream = toBuilderUrl(`/projects/${encodeURIComponent(proj.fb_project_id)}/files/${encodeURIComponent(path).replace(/%2F/g, '/')}`);
  try {
    const r = await builderFetchJson(upstream, { timeoutMs: 60000 });
    return res.status(r.status).json(r.body ?? {});
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message || 'upstream unreachable' } });
  }
});

// Builder download ZIP (stream)
app.get('/u/proxy/builder/projects/:id/download', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const upstream = toBuilderUrl(`/projects/${encodeURIComponent(proj.fb_project_id)}/download`);
  try {
    const r = await fetch(upstream);
    if (!r.ok || !r.body) {
      let out: any = null; try { out = await r.json(); } catch { out = null; }
      return res.status(r.status).json(out ?? { ok: false });
    }
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    const cd = r.headers.get('content-disposition');
    if (cd) res.setHeader('content-disposition', cd);
    const nodeStream = Readable.fromWeb(r.body as any);
    nodeStream.pipe(res);
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message || 'upstream unreachable' } });
  }
});

// Builder export to GitHub (write)
app.post('/u/proxy/builder/projects/:id/export/github', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });

  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:create:user:${userId}`, env.RL_BUILDER_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:create:ip:${ip}`, env.RL_BUILDER_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  const schema = z.object({ repo_name: z.string().max(128).optional().nullable() });
  const parse = schema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });

  const upstream = toBuilderUrl(`/api/projects/${encodeURIComponent(proj.fb_project_id)}/export-github`);
  try {
    const r = await builderFetchJson(upstream, { method: 'POST', body: parse.data, timeoutMs: 180000 });
    if (r.ok) {
      const ghUrl = String(r.body?.github_repo_url || r.body?.repo_html_url || '').trim();
      if (ghUrl) await updateBuilderProjectCache(proj.id, { github_url: ghUrl });
    }
    return res.status(r.status).json(r.body ?? {});
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message || 'upstream unreachable' } });
  }
});

// Builder events stream (SSE): bridges Frontend_Builder WS -> SSE for same-origin proxy usage
app.get('/u/proxy/builder/projects/:id/events/stream', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const proj = await getBuilderProjectById(userId, String(req.params.id || ''));
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found' } });

  function toBuilderWsUrl(path: string) {
    const baseHttp = String(env.FRONTEND_BUILDER_BASE_URL || '').replace(/\/+$/, '');
    const wsBase = baseHttp.startsWith('https://')
      ? `wss://${baseHttp.slice('https://'.length)}`
      : baseHttp.startsWith('http://')
        ? `ws://${baseHttp.slice('http://'.length)}`
        : baseHttp;
    const p = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
    return `${wsBase}${p}`;
  }

  function sseSend(ev: string, data: string) {
    // Avoid throwing/raising 'error' events if the client disconnected.
    if ((res as any).writableEnded || (res as any).destroyed) return;
    try {
      res.write(`event: ${ev}\n`);
      const lines = String(data ?? '').split('\n');
      for (const line of lines) res.write(`data: ${line}\n`);
      res.write('\n');
    } catch {
      // ignore
    }
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();
  sseSend('ready', JSON.stringify({ ok: true }));

  const upstreamUrl = toBuilderWsUrl(`/ws/${encodeURIComponent(String(proj.fb_project_id || ''))}`);
  const upstream = new WebSocket(upstreamUrl);

  const keepAlive = setInterval(() => {
    if (ended) return;
    sseSend('heartbeat', JSON.stringify({ t: Date.now() }));
  }, 15000);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(keepAlive);
    try { upstream.close(); } catch {}
    try { res.end(); } catch {}
  };

  // If the client closes the SSE connection, end the upstream WS too.
  req.on('close', end);

  // If Node emits an error on the response stream (e.g. write-after-end), stop upstream.
  // This prevents process-level uncaughtException crashes.
  res.on('error', end);

  upstream.on('open', () => {
    if (ended) return;
    sseSend('upstream_open', JSON.stringify({ ok: true }));
  });
  upstream.on('message', (data) => {
    if (ended) return;
    const payload = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    sseSend('message', payload);
  });
  upstream.on('close', () => {
    if (ended) return;
    sseSend('upstream_close', JSON.stringify({ ok: true }));
    end();
  });
  upstream.on('error', (e: any) => {
    if (ended) return;
    sseSend('error', JSON.stringify({ ok: false, error: { code: 'upstream_error', message: e?.message || 'upstream error' } }));
    end();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DApp wrapper endpoints: unified contract + frontend creation via Frontend_Builder
// ═══════════════════════════════════════════════════════════════════════════════

// Create DApp (contract + frontend) — proxies to Frontend_Builder /dapp/create
app.post('/u/proxy/builder/dapp/create', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden', message: 'CSRF token mismatch' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:create:user:${userId}`, env.RL_BUILDER_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:create:ip:${ip}`, env.RL_BUILDER_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited', message: 'Too many builder requests. Try again later.' } });
  const schema = z.object({
    prompt: z.string().min(4, 'Prompt must be at least 4 characters').max(20000),
    network: z.string().min(2).max(64).default('avalanche-fuji'),
    contract_only: z.boolean().default(false),
    game_mode: z.boolean().default(false),  // If true, generate interactive game UI; if false, generate creative website
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });
  const { prompt, network, contract_only, game_mode } = parse.data;
  console.log(JSON.stringify({ level: 'info', msg: 'dapp.create', userId, network, promptLen: prompt.length, game_mode }));
  let fbRes: globalThis.Response;
  try {
    const fbUrl = toBuilderUrl('/dapp/create');
    fbRes = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ prompt, network, contract_only, game_mode }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(JSON.stringify({ level: 'error', msg: 'dapp.create.fetch_failed', error: e?.message, isTimeout }));
    return res.status(504).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: isTimeout ? 'Frontend Builder did not respond in time' : e?.message } });
  }
  let fbData: any = null;
  try { fbData = await fbRes.json(); } catch { fbData = null; }
  if (!fbRes.ok || !fbData) {
    console.error(JSON.stringify({ level: 'error', msg: 'dapp.create.upstream_error', status: fbRes.status, body: fbData }));
    return res.status(fbRes.status >= 400 && fbRes.status < 600 ? fbRes.status : 502).json({ ok: false, error: { code: 'upstream_error', upstream_status: fbRes.status, detail: fbData } });
  }
  const fbProjectId = String(fbData.chat_id || fbData.id || '').trim();
  if (!fbProjectId) {
    console.error(JSON.stringify({ level: 'error', msg: 'dapp.create.no_project_id', body: fbData }));
    return res.status(502).json({ ok: false, error: { code: 'upstream_bad_response', message: 'Frontend Builder did not return a project ID' } });
  }
  const mapping = await createBuilderProjectMapping(userId, fbProjectId, `DApp: ${prompt.slice(0, 80)}`, 'dapp');
  await updateBuilderProjectCache(mapping.id, { contract_network: network });
  await insertAuditLog({ userId, event: 'builder.dapp.create', metadata: { id: mapping.id, fbProjectId, network } });
  console.log(JSON.stringify({ level: 'info', msg: 'dapp.create.success', userId, projectId: mapping.id, fbProjectId, network }));
  return res.json({ ok: true, project: { id: mapping.id, fb_project_id: fbProjectId, network, project_type: 'dapp', title: mapping.title, created_at: mapping.created_at } });
});

// Create frontend for existing contract — proxies to Frontend_Builder /dapp/frontend-for-contract
app.post('/u/proxy/builder/dapp/frontend-for-contract', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden', message: 'CSRF token mismatch' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:create:user:${userId}`, env.RL_BUILDER_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:create:ip:${ip}`, env.RL_BUILDER_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited', message: 'Too many builder requests. Try again later.' } });
  const schema = z.object({
    contract_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed Ethereum address'),
    abi: z.array(z.any()).min(1, 'ABI must contain at least one entry'),
    network: z.string().min(2).max(64),
    prompt: z.string().min(4, 'Prompt must be at least 4 characters').max(20000),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });
  const { contract_address, abi, network, prompt } = parse.data;
  console.log(JSON.stringify({ level: 'info', msg: 'dapp.frontend_for_contract', userId, contract_address, network }));
  let fbRes: globalThis.Response;
  try {
    const fbUrl = toBuilderUrl('/dapp/frontend-for-contract');
    fbRes = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ contract_address, abi, network, prompt }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(JSON.stringify({ level: 'error', msg: 'dapp.frontend_for_contract.fetch_failed', error: e?.message, isTimeout }));
    return res.status(504).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
  let fbData: any = null;
  try { fbData = await fbRes.json(); } catch { fbData = null; }
  if (!fbRes.ok || !fbData) {
    console.error(JSON.stringify({ level: 'error', msg: 'dapp.frontend_for_contract.upstream_error', status: fbRes.status }));
    return res.status(fbRes.status >= 400 && fbRes.status < 600 ? fbRes.status : 502).json({ ok: false, error: { code: 'upstream_error', upstream_status: fbRes.status, detail: fbData } });
  }
  const fbProjectId = String(fbData.chat_id || fbData.id || '').trim();
  if (!fbProjectId) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_bad_response', message: 'Frontend Builder did not return a project ID' } });
  }
  const row = await createBuilderProjectMapping(userId, fbProjectId, `Frontend: ${prompt.slice(0, 60)}`, 'dapp_frontend');
  await updateBuilderProjectCache(row.id, { contract_address, contract_network: network });
  await insertAuditLog({ userId, event: 'builder.dapp_frontend.create', metadata: { id: row.id, fbProjectId, contract_address, network } });
  console.log(JSON.stringify({ level: 'info', msg: 'dapp.frontend_for_contract.success', userId, projectId: row.id, fbProjectId }));
  return res.json({ ok: true, project: { id: row.id, fb_project_id: fbProjectId, network, project_type: 'dapp_frontend', title: row.title, created_at: row.created_at } });
});

// Get contracts for a builder project — proxies to Frontend_Builder /projects/:id/contracts
// Accepts both the DB row id (UUID) and the fb_project_id as the :id parameter.
app.get('/u/proxy/builder/projects/:id/contracts', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:builder:read:user:${userId}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:builder:read:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const paramId = String(req.params.id || '').trim();
  if (!paramId) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Missing project id' } });
  // Try lookup by DB id first, then by fb_project_id as fallback
  let proj = await getBuilderProjectById(userId, paramId);
  if (!proj) proj = await getBuilderProjectByFbId(userId, paramId);
  if (!proj) return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Project not found or not owned by user' } });
  let upstreamData: any = null;
  let upstreamOk = false;
  try {
    const fbUrl = toBuilderUrl(`/projects/${encodeURIComponent(proj.fb_project_id)}/contracts`);
    const r = await fetch(fbUrl, { signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      upstreamData = await r.json().catch(() => null);
      upstreamOk = !!upstreamData;
    }
  } catch (e: any) {
    console.log(JSON.stringify({ level: 'debug', msg: 'dapp.contracts.upstream_failed', projectId: proj.id, error: e?.message }));
  }
  // Build cached contract info from builder_projects if available
  const cachedContract = proj.contract_address ? {
    address: proj.contract_address,
    network: proj.contract_network,
    chain_id: proj.contract_chain_id,
    explorer_url: proj.contract_explorer_url,
    verified: proj.contract_verified,
    name: proj.contract_name,
  } : null;
  if (upstreamOk) {
    if (cachedContract) (upstreamData as any).cached_contract = cachedContract;
    return res.json(upstreamData);
  }
  // Upstream unavailable or returned error — serve from cache
  if (cachedContract) {
    return res.json({ ok: true, contracts: [{ contract_address: cachedContract.address, network: cachedContract.network, chain_id: cachedContract.chain_id, explorer_url: cachedContract.explorer_url, verified: cachedContract.verified, contract_name: cachedContract.name }], cached_contract: cachedContract, source: 'cache' });
  }
  // No upstream data and no cache — return empty contracts (not 502)
  return res.json({ ok: true, contracts: [], cached_contract: null, source: 'none', message: 'Contract data not yet available. The DApp may still be building.' });
});

// ═══════════════════════════════════════════════════════════════════════════════

app.post('/u/proxy/ai/pipeline', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  // CSRF optional for pipeline create (to avoid false 403s in dev/clients that don't attach the header)
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:create:user:${sess.user_id}`, env.RL_PIPELINE_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:create:ip:${ip}`, env.RL_PIPELINE_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const schema = z.object({
    prompt: z.string().min(4).max(20000),
    network: z.string().min(2).max(64),
    maxIters: z.number().min(1).max(50).optional(),
    filename: z.string().max(256).optional(),
    contractName: z.string().max(128).optional(),
    strictArgs: z.boolean().optional(),
    constructorArgs: z.array(z.any()).optional(),
    jobKind: z.string().optional(),
    context: z.string().max(1000).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request' } });
  const body = parse.data as any;
  // Validate network is supported
  if (!isNetworkSupported(body.network)) {
    const supported = getEnabledNetworks().map(n => n.id);
    return res.status(400).json({ ok: false, error: { code: 'unsupported_network', message: `Network '${body.network}' is not supported. Supported: ${supported.join(', ')}` } });
  }
  const enhanceOn = String(env.ENHANCE_PROMPT_ENABLED).toLowerCase() === '1' || String(env.ENHANCE_PROMPT_ENABLED).toLowerCase() === 'true';
  if (enhanceOn && typeof body.prompt === 'string' && body.prompt.trim().length) {
    const basePrompt = body.prompt;
    async function normalize(out: string): Promise<string> {
      let s = (out || '').trim();
      if (!s) return basePrompt;
      if (!/EMPTY\s+CONSTRUCTOR/i.test(s)) {
        const m = s.match(/^([A-Za-z_][\w]*)\s*:/);
        if (m) s = s.replace(m[0], `${m[0]} EMPTY CONSTRUCTOR. `);
        else s = `Contract: EMPTY CONSTRUCTOR.\n${s}`;
      }
      if (!/No\s+constructor\s+args\.?$/i.test(s)) {
        s = s.replace(/No\s+constructor\s+args\.?/gi, 'No constructor args.');
        if (!/No\s+constructor\s+args\.?$/i.test(s)) s = `${s}\nNo constructor args.`;
      }
      return s.trim();
    }
    async function tryHosted(): Promise<{ ok: boolean; prompt?: string; provider?: string; model?: string }> {
      if (!env.ENHANCE_PROMPT_URL) return { ok: false };
      try {
        const r = await fetch(env.ENHANCE_PROMPT_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ prompt: basePrompt }) });
        const j: any = await r.json().catch(() => null);
        if (r.ok && j?.ok && j?.data?.prompt) {
          return { ok: true, prompt: await normalize(String(j.data.prompt || '')), provider: j?.data?.provider, model: j?.data?.model };
        }
      } catch {}
      return { ok: false };
    }
    async function tryOpenAI(): Promise<{ ok: boolean; prompt?: string; provider?: string; model?: string }> {
      const key = env.OPENAI_API_KEY;
      if (!key) return { ok: false };
      const model = env.OPENAI_MODEL || 'gpt-4o-mini';
      const bodyReq = {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(basePrompt) },
        ],
      };
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(bodyReq) });
        if (!r.ok) return { ok: false };
        const j: any = await r.json().catch(() => null);
        const txt: string = j?.choices?.[0]?.message?.content || '';
        return txt ? { ok: true, prompt: await normalize(txt), provider: 'openai', model } : { ok: false };
      } catch { return { ok: false }; }
    }
    async function tryGemini(): Promise<{ ok: boolean; prompt?: string; provider?: string; model?: string }> {
      const key = env.GEMINI_API_KEY;
      if (!key) return { ok: false };
      const model = env.GEMINI_MODEL || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const content = buildGeminiContent(basePrompt);
      const bodyReq = { contents: [{ role: 'user', parts: [{ text: content }] }], generationConfig: { temperature: 0.2 } } as any;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout for prompt enhancement
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyReq), signal: controller.signal });
        clearTimeout(timeout);
        if (!r.ok) {
          console.log(JSON.stringify({ level: 'warn', msg: 'gemini.enhance.failed', status: r.status }));
          return { ok: false };
        }
        const j: any = await r.json().catch(() => null);
        const txt: string = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return txt ? { ok: true, prompt: await normalize(txt), provider: 'gemini', model } : { ok: false };
      } catch (err: any) {
        console.log(JSON.stringify({ level: 'warn', msg: 'gemini.enhance.error', error: err?.message || String(err) }));
        return { ok: false };
      }
    }
    let enhanced = { ok: false } as any;
    try {
      enhanced = await tryHosted();
      if (!enhanced.ok) enhanced = await tryOpenAI();
      if (!enhanced.ok) enhanced = await tryGemini();
    } catch {}
    if (enhanced?.ok && enhanced?.prompt) {
      body.prompt = enhanced.prompt;
      try { Sentry.setTag('guardrail_provider', enhanced.provider || 'base'); } catch {}
    } else {
      try { Sentry.setTag('guardrail_provider', 'base'); } catch {}
    }
  }
  // Extract contract name and filename from enhanced prompt (like Camp_V3 does)
  // Pattern: ContractName: at the start of a line
  if (typeof body.prompt === 'string' && body.prompt.trim().length) {
    const labelMatch = body.prompt.match(/^\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*:/m);
    if (labelMatch) {
      const contractName = labelMatch[1];
      // Only set filename if not already provided by client
      if (!body.filename) {
        body.filename = `${contractName}.sol`;
      }
      // Set contractName for upstream
      if (!body.contractName) {
        body.contractName = contractName;
      }
      console.log(JSON.stringify({ level: 'debug', msg: 'pipeline.contract_extracted', contractName, filename: body.filename }));
    } else if (!body.filename) {
      // Fallback filename if no contract name found
      body.filename = 'AIGenerated.sol';
    }
  }
  // Try V4; if forbidden, fallback to legacy base; if still denied, return 200 with non-upgrade error
  const upstreamUrl = `${env.EVI_V4_BASE_URL}/api/ai/pipeline`;
  console.log(JSON.stringify({ level: 'debug', msg: 'pipeline.upstream.request', url: upstreamUrl, body: { ...body, prompt: body.prompt?.slice(0, 100) + '...' } }));
  let upstreamRes: globalThis.Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 180s (3 min) timeout for pipeline upstream
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (fetchErr: any) {
    console.log(JSON.stringify({
      level: 'error',
      msg: 'pipeline.upstream.fetch_error',
      url: upstreamUrl,
      error: fetchErr?.message || String(fetchErr),
      cause: fetchErr?.cause?.message || fetchErr?.cause?.code || null,
      code: fetchErr?.code || null,
    }));
    return res.status(502).json({ ok: false, error: { code: 'upstream_fetch_failed', message: fetchErr?.message || 'Failed to connect to upstream' } });
  }
  let out: any = null;
  try { out = await upstreamRes.json(); } catch { out = null; }
  console.log(JSON.stringify({ level: 'debug', msg: 'pipeline.upstream.response', status: upstreamRes.status, hasBody: !!out, jobId: out?.job?.id || out?.jobId || null }));
  if (upstreamRes.status === 403) {
    try {
      const r2 = await fetch(`${env.EVI_BASE_URL}/api/ai/pipeline`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      let j2: any = null; try { j2 = await r2.json(); } catch { j2 = null; }
      if (r2.ok) { upstreamRes = r2; out = j2; }
      else { return res.status(200).json({ ok: false, error: { code: 'upstream_denied' }, detail: j2 }); }
    } catch {
      return res.status(200).json({ ok: false, error: { code: 'upstream_denied' } });
    }
  } else if (!upstreamRes.ok) {
    return res.status(upstreamRes.status).json(out ?? { ok: false });
  }
  // Normalize jobId extraction - upstream may return { jobId }, { id }, { data: { jobId } }, or { job: { id } }
  const jobId = out?.job?.id || out?.jobId || out?.id || out?.data?.jobId || '';
  if (jobId) {
    await attachUserJob({ jobId, userId: sess.user_id, type: 'pipeline', prompt: body.prompt ?? null, filename: body.filename ?? null, network: body.network });
    await incrMetric('jobsAttach');
    await insertAuditLog({ userId: sess.user_id, event: 'jobs.attach', metadata: { jobId, type: 'pipeline', network: body.network } });
    // Normalize response to ensure { job: { id } } format for frontend compatibility
    if (!out.job) out.job = { id: jobId };
    else if (!out.job.id) out.job.id = jobId;
  }
  return res.status(upstreamRes.status).json(out);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Service-to-service endpoints: Frontend_Builder → user-api
// Auth: Bearer USERAPI_SERVICE_SECRET + X-User-Id header
// ═══════════════════════════════════════════════════════════════════════════════

// Service: POST pipeline (Frontend_Builder DApp orchestrator calls this instead of EVI directly)
app.post('/u/service/ai/pipeline', requireServiceAuth, async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'service';
  const rlU = await allow(`rl:svc:pipeline:user:${userId}`, env.RL_PIPELINE_CREATE_PER_15M, 15 * 60);
  if (!rlU.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const schema = z.object({
    prompt: z.string().min(4).max(20000),
    network: z.string().min(2).max(64),
    maxIters: z.number().min(1).max(50).optional(),
    filename: z.string().max(256).optional(),
    contractName: z.string().max(128).optional(),
    strictArgs: z.boolean().optional(),
    constructorArgs: z.array(z.any()).optional(),
    context: z.string().max(1000).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });
  const body = parse.data as any;
  if (!isNetworkSupported(body.network)) {
    return res.status(400).json({ ok: false, error: { code: 'unsupported_network', message: `Network '${body.network}' is not supported.` } });
  }
  const upstreamUrl = `${env.EVI_V4_BASE_URL}/api/ai/pipeline`;
  console.log(JSON.stringify({ level: 'info', msg: 'service.pipeline.create', userId, network: body.network }));
  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: { code: 'upstream_fetch_failed', message: e?.message } });
  }
  let out: any = null;
  try { out = await upstreamRes.json(); } catch { out = null; }
  if (upstreamRes.status === 403) {
    try {
      const r2 = await fetch(`${env.EVI_BASE_URL}/api/ai/pipeline`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      let j2: any = null; try { j2 = await r2.json(); } catch {}
      if (r2.ok) { out = j2; }
      else return res.status(200).json({ ok: false, error: { code: 'upstream_denied' }, detail: j2 });
    } catch { return res.status(200).json({ ok: false, error: { code: 'upstream_denied' } }); }
  } else if (!upstreamRes.ok) {
    return res.status(upstreamRes.status).json(out ?? { ok: false });
  }
  const jobId = out?.job?.id || out?.jobId || out?.id || out?.data?.jobId || '';
  if (jobId) {
    await attachUserJob({ jobId, userId, type: 'pipeline', prompt: body.prompt ?? null, filename: body.filename ?? null, network: body.network });
    await insertAuditLog({ userId, event: 'service.jobs.attach', metadata: { jobId, type: 'pipeline', network: body.network } });
    if (!out.job) out.job = { id: jobId };
    else if (!out.job.id) out.job.id = jobId;
  }
  return res.status(200).json(out);
});

// Service: GET job status
app.get('/u/service/job/:id/status', requireServiceAuth, async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const { id } = req.params;
  if (!id || id.length < 4) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Invalid job id' } });
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}/status${qs}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const out = await r.json().catch(() => ({}));
    if (out && typeof out === 'object') {
      const state = out?.data?.state || out?.state || '';
      const progress = out?.data?.progress ?? out?.progress ?? 0;
      const address = out?.data?.result?.address || out?.result?.address || null;
      const fqName = out?.data?.result?.fq_name || out?.result?.fq_name || null;
      if (state) {
        try {
          await upsertJobCache({
            jobId: id, state, progress: Number(progress) || 0,
            address: address || undefined,
            fq_name: fqName || undefined,
            completed_at: (state === 'completed' || state === 'failed') ? new Date() : undefined,
          });
        } catch (dbErr: any) {
          console.error(JSON.stringify({ level: 'error', msg: 'service.job_status.cache_upsert_failed', jobId: id, error: dbErr?.message }));
        }
      }
    }
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(JSON.stringify({ level: 'error', msg: 'service.job_status.failed', jobId: id, error: e?.message, isTimeout }));
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: GET job detail
app.get('/u/service/job/:id', requireServiceAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id || id.length < 4) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Invalid job id' } });
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const out = await r.json().catch(() => ({}));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: GET artifacts (sources, ABIs, etc.)
app.get('/u/service/artifacts', requireServiceAuth, async (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  if (!qs.includes('jobId=')) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'jobId query parameter required' } });
  const url = `${env.EVI_BASE_URL}/api/artifacts${qs}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const out = await r.json().catch(() => ({}));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: GET artifacts/sources
app.get('/u/service/artifacts/sources', requireServiceAuth, async (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  if (!qs.includes('jobId=')) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'jobId query parameter required' } });
  const url = `${env.EVI_BASE_URL}/api/artifacts/sources${qs}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const out = await r.json().catch(() => ({}));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: GET artifacts/abis
app.get('/u/service/artifacts/abis', requireServiceAuth, async (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  if (!qs.includes('jobId=')) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'jobId query parameter required' } });
  const url = `${env.EVI_BASE_URL}/api/artifacts/abis${qs}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const out = await r.json().catch(() => ({}));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: POST verify by job
// NOTE: The upstream EVI verify endpoint requires { jobId, network }. If network is missing,
// we attempt to look it up from user_jobs. This fixes the 404 that occurs when network is omitted.
app.post('/u/service/verify/byJob', requireServiceAuth, async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const schema = z.object({
    jobId: z.string().min(1),
    network: z.string().min(2).max(64).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });
  let { jobId, network } = parse.data;
  // If no network provided, look it up from user_jobs
  if (!network) {
    try {
      const jobRow = await getUserJobWithCache(userId, jobId);
      network = jobRow?.network || undefined;
    } catch {}
  }
  if (!network) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'network is required for verification. Provide it in the request body or ensure the job is attached to the user.' } });
  }
  const url = `${env.EVI_BASE_URL}/api/verify/byJob`;
  console.log(JSON.stringify({ level: 'info', msg: 'service.verify.request', userId, jobId, network }));
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, network }),
      signal: AbortSignal.timeout(120000),
    });
    const out = await r.json().catch(() => ({}));
    if (r.ok && out) {
      try {
        await upsertJobCache({
          jobId, state: 'completed',
          verified: !!(out?.verified ?? out?.ok),
          explorer_url: out?.explorerUrl || out?.explorer_url || null,
        });
      } catch (dbErr: any) {
        console.error(JSON.stringify({ level: 'error', msg: 'service.verify.cache_failed', jobId, error: dbErr?.message }));
      }
    }
    console.log(JSON.stringify({ level: 'info', msg: 'service.verify.response', jobId, status: r.status, verified: out?.verified }));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(JSON.stringify({ level: 'error', msg: 'service.verify.failed', jobId, error: e?.message, isTimeout }));
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: POST audit by job
app.post('/u/service/audit/byJob', requireServiceAuth, async (req: Request, res: Response) => {
  const schema = z.object({
    jobId: z.string().min(1),
    model: z.string().max(128).optional(),
    policy: z.any().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });
  const url = `${env.EVI_BASE_URL}/api/audit/byJob`;
  console.log(JSON.stringify({ level: 'info', msg: 'service.audit.request', jobId: parse.data.jobId }));
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(parse.data),
      signal: AbortSignal.timeout(180000),
    });
    const out = await r.json().catch(() => ({}));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(JSON.stringify({ level: 'error', msg: 'service.audit.failed', jobId: parse.data.jobId, error: e?.message }));
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: POST compliance by job
app.post('/u/service/compliance/byJob', requireServiceAuth, async (req: Request, res: Response) => {
  const schema = z.object({
    jobId: z.string().min(1),
    model: z.string().max(128).optional(),
    policy: z.any().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', details: parse.error.issues } });
  const url = `${env.EVI_BASE_URL}/api/compliance/byJob`;
  console.log(JSON.stringify({ level: 'info', msg: 'service.compliance.request', jobId: parse.data.jobId }));
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(parse.data),
      signal: AbortSignal.timeout(180000),
    });
    const out = await r.json().catch(() => ({}));
    return res.status(r.status).json(out);
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(JSON.stringify({ level: 'error', msg: 'service.compliance.failed', jobId: parse.data.jobId, error: e?.message }));
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: { code: isTimeout ? 'upstream_timeout' : 'upstream_unreachable', message: e?.message } });
  }
});

// Service: GET job logs SSE stream
app.get('/u/service/job/:id/logs/stream', requireServiceAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}/logs/stream`;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      res.write(`data: ${JSON.stringify({ error: 'upstream_error', status: upstream.status })}\n\n`);
      res.end();
      return;
    }
    const reader = (upstream.body as any).getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    };
    pump().catch(() => res.end());
    req.on('close', () => { try { reader.cancel(); } catch {} });
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ error: 'upstream_unreachable', message: e?.message })}\n\n`);
    res.end();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════

// Wrapper: GET job detail
app.get('/u/proxy/job/:id', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const { id } = req.params;
  try { const own = await userOwnsJob(sess.user_id, id); if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } }); } catch {}
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}${qs}`;
  let r: any;
  try { r = await fetch(url); } catch (e: any) { try { Sentry.captureMessage('upstream_unreachable', { level: 'error', extra: { route: '/u/proxy/job/:id', id, url, error: e?.message } as any }); } catch {}; return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable' } }); }
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  const includeMagical = ['1', 'true', 'yes'].includes(String(req.query.includeMagical || '').toLowerCase());
  if (includeMagical && out) {
    try {
      const logs = Array.isArray(out?.data?.logs) ? out.data.logs : (Array.isArray(out?.logs) ? out.logs : []);
      const ctx = { network: out?.data?.result?.network || out?.result?.network, contractName: out?.data?.result?.contract || out?.result?.contract } as any;
      const magical: any[] = [];
      for (const l of logs) {
        const m = magicalFromLog(String(l?.msg || ''), ctx);
        if (m?.length) magical.push(...m);
      }
      (out as any).magical = magical;
    } catch {}
  }
  return res.status(r.status).json(out ?? {});
});

// Wrapper: GET job status
app.get('/u/proxy/job/:id/status', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const { id } = req.params;
  try { const own = await userOwnsJob(sess.user_id, id); if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } }); } catch {}
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}/status${qs}`;
  let r: any;
  try { r = await fetch(url); } catch (e: any) { try { Sentry.captureMessage('upstream_unreachable', { level: 'error', extra: { route: '/u/proxy/job/:id/status', id, url, error: e?.message } as any }); } catch {}; return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable' } }); }
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  return res.status(r.status).json(out ?? {});
});

// Wrapper: GET job logs (polling)
app.get('/u/proxy/job/:id/logs', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });
  const { id } = req.params;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString() ? `?${search.toString()}` : '';
  const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}/logs${qs}`;
  let r: any;
  try { r = await fetch(url); } catch (e: any) { try { Sentry.captureMessage('upstream_unreachable', { level: 'error', extra: { route: '/u/proxy/job/:id/logs', id, url, error: e?.message } as any }); } catch {}; return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable' } }); }
  let out: any = null; try { out = await r.json(); } catch { out = null; }
  return res.status(r.status).json(out ?? {});
});

// Wrapper: SSE job logs stream
app.get('/u/proxy/job/:id/logs/stream', async (req: Request, res: Response) => {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  try { const own = await userOwnsJob(sess.user_id, String(req.params.id || '')); if (!own) return res.status(404).end(); } catch {}
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wrapper:read:user:${sess.user_id}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wrapper:read:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { (res as any).flushHeaders?.(); } catch {}

  const { id } = req.params;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString() ? `?${search.toString()}` : '';
  const upstreamUrl = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(id)}/logs/stream${qs}`;

  let closed = false;
  const controller = new AbortController();
  let sawEndEvent = false;
  let pingTimer: any = setInterval(() => {
    if (closed) return;
    try {
      res.write(`event: ping\n`);
      res.write(`data: {"ts": ${Date.now()} }\n\n`);
    } catch {}
  }, 15000);
  req.on('close', () => {
    closed = true;
    try { controller.abort(); } catch {}
    if (pingTimer) { try { clearInterval(pingTimer); } catch {}; pingTimer = null; }
  });

  // Auto-verify helper: called when we detect the job stream has ended
  async function triggerAutoVerification(jobId: string) {
    if (closed) return;
    try {
      console.log(JSON.stringify({ level: 'info', msg: 'sse_proxy_auto_verify_trigger', jobId }));
      const writeVerifyEvent = (ev: string, data: any) => {
        if (closed) return;
        try { res.write(`event: ${ev}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
      };
      // Small delay to let upstream finalize deploy state
      await new Promise(r => setTimeout(r, 3000));
      const deployStatus = await checkJobDeploymentStatus(jobId);
      console.log(JSON.stringify({ level: 'info', msg: 'sse_proxy_deploy_status', jobId, deployed: deployStatus.deployed, address: deployStatus.address, network: deployStatus.network, fqName: deployStatus.fqName }));
      if (deployStatus.deployed && deployStatus.network) {
        writeVerifyEvent('verification.started', { jobId, network: deployStatus.network, address: deployStatus.address });
        writeVerifyEvent('log', { msg: `Stage: verify`, level: 'info', i: Date.now() });
        writeVerifyEvent('log', { msg: `Starting auto-verification on ${deployStatus.network}...`, level: 'info', i: Date.now() + 1 });
        const verifyResult = await autoVerifyContract(jobId, deployStatus.network, deployStatus.fqName);
        console.log(JSON.stringify({ level: 'info', msg: 'sse_proxy_verify_result', jobId, ...verifyResult }));
        writeVerifyEvent('verification.complete', { jobId, ...verifyResult });
        if (verifyResult.ok) {
          writeVerifyEvent('log', { msg: `✅ Contract verified successfully on ${deployStatus.network}`, level: 'info', i: Date.now() + 2 });
          // Update job_cache with verified status
          try {
            await upsertJobCache({ jobId, state: 'completed', verified: true });
          } catch {}
        } else {
          writeVerifyEvent('log', { msg: `⚠️ Contract verification failed: ${verifyResult.error || 'unknown error'}`, level: 'warn', i: Date.now() + 2 });
        }
      } else {
        console.log(JSON.stringify({ level: 'warn', msg: 'sse_proxy_verify_skip', jobId, reason: 'not_deployed_or_no_network' }));
        writeVerifyEvent('log', { msg: `⚠️ Skipping verification: contract deploy status not confirmed`, level: 'warn', i: Date.now() });
      }
    } catch (e: any) {
      console.error(JSON.stringify({ level: 'error', msg: 'sse_proxy_auto_verify_error', jobId, error: e?.message }));
    }
  }

  async function pump(attempt = 0) {
    if (closed) return;
    try {
      const r = await fetch(upstreamUrl, { signal: controller.signal });
      if (!r.ok || !r.body) {
        try { Sentry.captureMessage('sse_upstream_status', { level: 'error', extra: { status: r.status, url: upstreamUrl } as any }); } catch {}
        res.write(`event: error\n`);
        res.write(`data: {"message":"upstream_status_${r.status}"}\n\n`);
        return res.end();
      }
      const nodeStream = Readable.fromWeb(r.body as any);
      let buffer = '';
      function writeEvent(ev: string, data: any) {
        try {
          res.write(`event: ${ev}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {}
      }
      nodeStream.on('data', (chunk) => {
        try {
          const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          buffer += s;
          let idx = buffer.indexOf('\n\n');
          while (idx !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = frame.split('\n');
            let ev = 'message';
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith('event:')) ev = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const dataStr = dataLines.join('\n');
            let obj: any = null; try { obj = JSON.parse(dataStr); } catch {}
            // Detect end event to trigger verification
            if (ev === 'end') sawEndEvent = true;
            if (ev === 'log' && obj && typeof obj.msg === 'string') {
              const magic = magicalFromLog(String(obj.msg), {});
              writeEvent(ev, obj);
              if (Array.isArray(magic) && magic.length) {
                for (const m of magic) writeEvent('magic', m);
              }
            } else {
              if (ev) writeEvent(ev, obj ?? dataStr);
            }
            idx = buffer.indexOf('\n\n');
          }
        } catch {}
      });
      nodeStream.on('end', async () => {
        if (closed) return;
        // If we saw an 'end' event, the job is done — trigger verification before closing
        if (sawEndEvent) {
          try {
            await triggerAutoVerification(id);
          } catch (e: any) {
            console.error(JSON.stringify({ level: 'error', msg: 'sse_verify_on_end_error', jobId: id, error: e?.message }));
          }
          try { res.end(); } catch {}
          return;
        }
        if (attempt < 5) {
          setTimeout(() => pump(attempt + 1), 300 + attempt * 300);
        } else {
          try {
            res.write(`event: error\n`);
            res.write(`data: {"message":"upstream_disconnected"}\n\n`);
          } finally { res.end(); }
        }
      });
      nodeStream.on('error', () => {
        if (closed) return;
        try { Sentry.captureMessage('sse_stream_error', { level: 'error', extra: { url: upstreamUrl, attempt } as any }); } catch {}
        if (attempt < 5) setTimeout(() => pump(attempt + 1), 300 + attempt * 300);
        else { try { res.write(`event: error\n`); res.write(`data: {"message":"stream_error"}\n\n`); } finally { res.end(); } }
      });
    } catch (_e) {
      if (closed) return;
      try { Sentry.captureMessage('sse_fetch_failed', { level: 'error', extra: { url: upstreamUrl, attempt } as any }); } catch {}
      if (attempt < 5) setTimeout(() => pump(attempt + 1), 300 + attempt * 300);
      else { try { res.write(`event: error\n`); res.write(`data: {"message":"fetch_failed"}\n\n`); } finally { res.end(); } }
    }
  }
  pump();
});

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Deployment Wrappers (Pro-only: requires wallet_deployments entitlement)
// ─────────────────────────────────────────────────────────────────────────────

// Network configurations for wallet-based deployment
const WALLET_NETWORK_CONFIGS: Record<string, { chainId: number; name: string; rpcUrl: string; explorer: string; currency: string; isTestnet: boolean }> = {
  'avalanche-fuji': {
    chainId: 43113,
    name: 'Avalanche Fuji Testnet',
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    explorer: 'https://testnet.snowtrace.io',
    currency: 'AVAX',
    isTestnet: true,
  },
  'avalanche-mainnet': {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorer: 'https://snowtrace.io',
    currency: 'AVAX',
    isTestnet: false,
  },
  'basecamp': {
    chainId: 123420001114,
    name: 'Basecamp',
    rpcUrl: 'https://rpc.basecamp.t.raas.gelato.cloud',
    explorer: 'https://basecamp.cloud.blockscout.com',
    currency: 'CAMP',
    isTestnet: true,
  },
  'basecamp-testnet': {
    chainId: 123420001114,
    name: 'Basecamp',
    rpcUrl: 'https://rpc.basecamp.t.raas.gelato.cloud',
    explorer: 'https://basecamp.cloud.blockscout.com',
    currency: 'CAMP',
    isTestnet: true,
  },
  'camp-network-testnet': {
    chainId: 325000,
    name: 'Camp Network Testnet V2',
    rpcUrl: 'https://rpc.camp-network-testnet.gelato.digital',
    explorer: 'https://camp-network-testnet.blockscout.com',
    currency: 'ETH',
    isTestnet: true,
  },
  'ethereum-sepolia': {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: 'https://rpc.sepolia.org',
    explorer: 'https://sepolia.etherscan.io',
    currency: 'ETH',
    isTestnet: true,
  },
  'ethereum-mainnet': {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    currency: 'ETH',
    isTestnet: false,
  },
};

// POST /u/proxy/wallet/deploy - Start wallet-based deployment (Pro only)
app.post('/u/proxy/wallet/deploy', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wallet:deploy:user:${userId}`, env.RL_PIPELINE_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wallet:deploy:ip:${ip}`, env.RL_PIPELINE_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const schema = z.object({
    prompt: z.string().min(4).max(20000),
    network: z.string().min(2).max(64).optional().default('avalanche-fuji'),
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    callbackUrl: z.string().url().max(1024).optional(),
    constructorArgs: z.array(z.any()).optional(),
    strictArgs: z.boolean().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: parse.error.flatten() } });

  // Normalize and validate network
  const requestedNetwork = parse.data.network?.toLowerCase().replace(/\s+/g, '-') || 'avalanche-fuji';
  const networkConfig = WALLET_NETWORK_CONFIGS[requestedNetwork];
  if (!networkConfig) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'invalid_network',
        detail: `Unsupported network: ${requestedNetwork}. Supported: ${Object.keys(WALLET_NETWORK_CONFIGS).join(', ')}`,
      },
    });
  }

  // Log network selection for debugging
  console.log(JSON.stringify({
    level: 'info',
    msg: 'wallet.deploy.network_selected',
    userId,
    network: requestedNetwork,
    chainId: networkConfig.chainId,
    networkName: networkConfig.name,
  }));

  const hardenedPrompt = `${parse.data.prompt}

Technical constraints (MUST follow):
- Add SPDX-License-Identifier: UNLICENSED on line 1.
- Use pragma solidity ^0.8.20; on line 2.
- The contract MUST compile standalone with NO dependencies.
- Do NOT include ANY import statements of any kind. No OpenZeppelin imports. No external library imports. No import lines at all.
- Do NOT inherit from any external base contracts (imports are forbidden). No "is Ownable", no "is ReentrancyGuard", etc.
- EMPTY CONSTRUCTOR: the contract MUST have constructor() {} with NO arguments. No constructor params. No deployment-time configuration.
- Do NOT use immutable variables that would require constructor args.
- Do NOT include NatSpec docstrings or tags (no /** ... */ blocks, no @return, no @param, no @notice, no @dev). Use simple // comments only.
- One contract in one file. No local/relative imports.
- Decompose behavior into multiple small functions; avoid monolithic multi-purpose functions.
- Do not reuse identifiers between functions and variables; do not shadow Solidity globals (msg, tx, block, gasleft).
- Emit events for all state-changing actions.
No constructor args.`;

  const upstream = `${env.EVI_BASE_URL}/api/wallet/deploy-with-wallet`;
  try {
    // Build payload with network-specific configuration
    const payload = {
      ...parse.data,
      prompt: hardenedPrompt,
      network: requestedNetwork,
      chainId: networkConfig.chainId,
      networkName: networkConfig.name,
      rpcUrl: networkConfig.rpcUrl,
      explorerUrl: networkConfig.explorer,
    };

    const r = await fetch(upstream, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    const jobId = out?.jobId || out?.job?.id;
    if (jobId) {
      await attachUserJob({
        jobId,
        userId,
        type: 'wallet_deploy',
        prompt: parse.data.prompt,
        filename: null,
        network: requestedNetwork,
      });
      await insertAuditLog({
        userId,
        event: 'wallet.deploy.start',
        metadata: {
          jobId,
          network: requestedNetwork,
          chainId: networkConfig.chainId,
          walletAddress: parse.data.walletAddress,
        },
      });
    }

    // Enrich response with network config for frontend
    if (out && r.ok) {
      out.networkConfig = {
        network: requestedNetwork,
        chainId: networkConfig.chainId,
        name: networkConfig.name,
        explorer: networkConfig.explorer,
        currency: networkConfig.currency,
        isTestnet: networkConfig.isTestnet,
      };
    }

    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

// GET /u/proxy/wallet/networks - List available networks for wallet deployment (public)
app.get('/u/proxy/wallet/networks', async (_req: Request, res: Response) => {
  const networks = Object.entries(WALLET_NETWORK_CONFIGS).map(([key, config]) => ({
    id: key,
    name: config.name,
    chainId: config.chainId,
    currency: config.currency,
    explorer: config.explorer,
    rpcUrl: config.rpcUrl,
    isTestnet: config.isTestnet,
  }));
  // Sort with avalanche-fuji first (priority), then testnets, then mainnets
  networks.sort((a, b) => {
    if (a.id === 'avalanche-fuji') return -1;
    if (b.id === 'avalanche-fuji') return 1;
    if (a.isTestnet !== b.isTestnet) return a.isTestnet ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return res.json({
    ok: true,
    networks,
    default: 'avalanche-fuji',
  });
});

// GET /u/proxy/wallet/sign/:sessionId - Get session details for signing (Pro only)
app.get('/u/proxy/wallet/sign/:sessionId', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wallet:sign:user:${userId}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wallet:sign:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { sessionId } = req.params;
  if (!sessionId || !/^sess_[\w-]+$/.test(sessionId)) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: 'Invalid sessionId format' } });
  }

  const upstream = `${env.EVI_BASE_URL}/api/wallet/sign/${encodeURIComponent(sessionId)}`;
  try {
    const r = await fetch(upstream);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

// POST /u/proxy/wallet/sign/:sessionId/submit - Submit signed transaction (Pro only)
app.post('/u/proxy/wallet/sign/:sessionId/submit', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wallet:submit:user:${userId}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wallet:submit:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const { sessionId } = req.params;
  if (!sessionId || !/^sess_[\w-]+$/.test(sessionId)) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: 'Invalid sessionId format' } });
  }

  const schema = z.object({
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: parse.error.flatten() } });

  const upstream = `${env.EVI_BASE_URL}/api/wallet/sign/${encodeURIComponent(sessionId)}/submit`;
  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(parse.data),
    });
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    if (r.ok && out?.jobId) {
      await insertAuditLog({ userId, event: 'wallet.deploy.submit', metadata: { sessionId, jobId: out.jobId, txHash: parse.data.txHash } });
      // Schedule auto-verification after a delay to allow deployment to complete
      const jobId = out.jobId;
      setTimeout(async () => {
        try {
          // Poll for deployment completion (max 5 attempts, 10s apart)
          for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
            const status = await checkJobDeploymentStatus(jobId);
            if (status.deployed && status.network) {
              console.log(JSON.stringify({ level: 'info', msg: 'wallet_deploy_auto_verify', jobId, network: status.network }));
              await autoVerifyContract(jobId, status.network, status.fqName);
              break;
            }
          }
        } catch (e: any) {
          console.error(JSON.stringify({ level: 'error', msg: 'wallet_deploy_auto_verify_error', jobId, error: e?.message }));
        }
      }, 5000); // Start polling after 5s
    }
    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

// GET /u/proxy/wallet/sessions/stats - Get session statistics (Pro only)
app.get('/u/proxy/wallet/sessions/stats', requireAuth, requireEntitlement('pro_enabled'), async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:wallet:stats:user:${userId}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:wallet:stats:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const upstream = `${env.EVI_BASE_URL}/api/wallet/sessions/stats`;
  try {
    const r = await fetch(upstream);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Verification Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Automatically verify a deployed contract by jobId
 * This is called after successful deployment to ensure contracts are verified on block explorer
 */
async function autoVerifyContract(jobId: string, network: string, fullyQualifiedName?: string): Promise<{ ok: boolean; verified?: boolean; error?: string }> {
  try {
    const upstream = `${env.EVI_BASE_URL}/api/verify/byJob`;
    const reqBody = { jobId, network, fullyQualifiedName };
    console.log(JSON.stringify({ level: 'info', msg: 'auto_verify_start', jobId, network, fullyQualifiedName: fullyQualifiedName || null, upstream }));

    const r = await fetch(upstream, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    const rawText = await r.text().catch(() => '');
    let out: any = null;
    try { out = JSON.parse(rawText); } catch {}

    console.log(JSON.stringify({
      level: r.ok && out?.ok ? 'info' : 'warn',
      msg: 'auto_verify_response',
      jobId, network, upstream,
      httpStatus: r.status,
      responseOk: out?.ok ?? null,
      verified: out?.verified ?? null,
      responseError: out?.error ?? null,
      responsePreview: rawText.slice(0, 500),
    }));

    if (r.ok && out?.ok) {
      return { ok: true, verified: out?.verified ?? true };
    } else {
      const errMsg = typeof out?.error === 'string' ? out.error : (out?.error?.message || out?.message || `Verification failed (HTTP ${r.status})`);
      return { ok: false, error: errMsg };
    }
  } catch (e: any) {
    console.error(JSON.stringify({ level: 'error', msg: 'auto_verify_error', jobId, network, error: e?.message, stack: e?.stack?.split('\n').slice(0, 3) }));
    return { ok: false, error: e?.message || 'Verification error' };
  }
}

/**
 * Check if a job has completed deployment and get the contract address
 */
async function checkJobDeploymentStatus(jobId: string): Promise<{ deployed: boolean; address?: string; network?: string; fqName?: string }> {
  try {
    const url = `${env.EVI_BASE_URL}/api/job/${encodeURIComponent(jobId)}`;
    console.log(JSON.stringify({ level: 'info', msg: 'check_deploy_status_start', jobId, url }));
    const r = await fetch(url);
    const data: any = await r.json().catch(() => null);

    const state = data?.data?.state || data?.state;
    const address = data?.data?.result?.address || data?.result?.address;
    const network = data?.data?.result?.network || data?.result?.network || data?.data?.network || data?.network;
    const fqName = data?.data?.result?.fqName || data?.result?.fqName;

    console.log(JSON.stringify({
      level: 'info', msg: 'check_deploy_status_result', jobId,
      httpStatus: r.status, state, address: address || null, network: network || null, fqName: fqName || null,
    }));

    if ((state === 'deployed' || state === 'completed') && address) {
      return { deployed: true, address, network, fqName };
    }
    return { deployed: false };
  } catch (e: any) {
    console.error(JSON.stringify({ level: 'error', msg: 'check_deploy_status_error', jobId, error: e?.message }));
    return { deployed: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify Wrappers (authenticated, available to all users)
// ─────────────────────────────────────────────────────────────────────────────

// POST /u/proxy/verify/byAddress - Verify contract by address
app.post('/u/proxy/verify/byAddress', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:verify:user:${userId}`, env.RL_PIPELINE_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:verify:ip:${ip}`, env.RL_PIPELINE_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const schema = z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
    network: z.string().min(2).max(64).optional().default('basecamp'),
    fullyQualifiedName: z.string().max(256).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: parse.error.flatten() } });

  const upstream = `${env.EVI_BASE_URL}/api/verify/byAddress`;
  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(parse.data),
    });
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    await insertAuditLog({ userId, event: 'verify.byAddress', metadata: { address: parse.data.address, network: parse.data.network } });
    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

// POST /u/proxy/verify/byJob - Verify contract using job artifacts
app.post('/u/proxy/verify/byJob', requireAuth, async (req: Request, res: Response) => {
  const csrfH = req.get('x-csrf-token') || '';
  const csrfC = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!csrfH || csrfH !== csrfC) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:verify:user:${userId}`, env.RL_PIPELINE_CREATE_PER_15M, 15 * 60);
  const rlI = await allow(`rl:verify:ip:${ip}`, env.RL_PIPELINE_CREATE_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const schema = z.object({
    jobId: z.string().min(6),
    network: z.string().min(2).max(64).optional().default('basecamp'),
    fullyQualifiedName: z.string().max(256).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: parse.error.flatten() } });

  // Verify user owns the job
  try {
    const own = await userOwnsJob(userId, parse.data.jobId);
    if (!own) return res.status(404).json({ ok: false, error: { code: 'not_found' } });
  } catch {}

  const upstream = `${env.EVI_BASE_URL}/api/verify/byJob`;
  console.log(JSON.stringify({ level: 'debug', msg: 'verify.byJob.request', upstream, body: parse.data }));
  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(parse.data),
    });
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    console.log(JSON.stringify({ level: 'debug', msg: 'verify.byJob.response', status: r.status, ok: out?.ok, verified: out?.verified }));
    await insertAuditLog({ userId, event: 'verify.byJob', metadata: { jobId: parse.data.jobId, network: parse.data.network } });
    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    console.log(JSON.stringify({ level: 'error', msg: 'verify.byJob.error', error: e?.message }));
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

// GET /u/proxy/verify/status - Check contract verification status
app.get('/u/proxy/verify/status', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).auth.userId as string;
  const ip = getClientIp(req.headers['x-forwarded-for'], req.ip) || 'unknown';
  const rlU = await allow(`rl:verify:status:user:${userId}`, env.RL_WRAPPER_READ_USER_PER_15M, 15 * 60);
  const rlI = await allow(`rl:verify:status:ip:${ip}`, env.RL_WRAPPER_READ_IP_PER_15M, 15 * 60);
  if (!rlU.ok || !rlI.ok) return res.status(429).json({ ok: false, error: { code: 'rate_limited' } });

  const schema = z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
    network: z.string().min(2).max(64).optional().default('basecamp'),
  });
  const parse = schema.safeParse(req.query);
  if (!parse.success) return res.status(400).json({ ok: false, error: { code: 'bad_request', detail: parse.error.flatten() } });

  const upstream = `${env.EVI_BASE_URL}/api/verify/status?address=${encodeURIComponent(parse.data.address)}&network=${encodeURIComponent(parse.data.network)}`;
  try {
    const r = await fetch(upstream);
    let out: any = null; try { out = await r.json(); } catch { out = null; }
    return res.status(r.status).json(out ?? {});
  } catch (e: any) {
    try { Sentry.captureException(e); } catch {}
    return res.status(502).json({ ok: false, error: { code: 'upstream_unreachable', message: e?.message } });
  }
});

async function seedAdmins() {
  const raw = String(env.SEED_ADMIN_EMAILS || '');
  if (!raw) return;
  const emails = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    try {
      const u = await upsertUserByEmail(email);
      await ensureEntitlements(u.id);
      // Always ensure admin has full entitlements (role, pro, wallet_deployments, etc.)
      await setUserRoleAndEntitlements(u.id, {
        role: 'admin',
        pro_enabled: true,
        wallet_deployments: true,
        history_export: true,
        chat_agents: true,
        hosted_frontend: true,
      });
      if (u.role !== 'admin') {
        await insertAuditLog({ userId: u.id, event: 'role.upgrade', metadata: { to: 'admin' } });
      }
    } catch (e: any) {
      console.error(JSON.stringify({ level: 'error', msg: 'seed_admin_failed', email, error: e?.message }));
    }
  }
}

(async () => {
  try { await initSchema(); } catch (_e) {}
  await seedAdmins();
})();

// Start server
const server = app.listen(env.PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`user-api listening on http://localhost:${env.PORT}`);
});

// WebSocket: Blockchain Pipeline endpoint
const wss = new WebSocketServer({ server });
const wsHeartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const c: any = client;
    if (c.isAlive === false) { try { c.terminate(); } catch {}; continue; }
    c.isAlive = false;
    try { client.ping(); } catch {}
  }
}, 30000);
wss.on('close', () => { clearInterval(wsHeartbeat); });

function parseCookies(h: string | undefined) {
  const out: Record<string, string> = {};
  if (!h) return out;
  const parts = h.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

async function enhancePrompt(input: { prompt: string; network: string; filename?: string | null; strictArgs?: boolean | null }) {
  const body = { prompt: input.prompt, network: input.network, filename: input.filename, strictArgs: input.strictArgs } as any;
  try {
    if ((String(env.ENHANCE_PROMPT_ENABLED) === '1' || String(env.ENHANCE_PROMPT_ENABLED).toLowerCase() === 'true') && env.ENHANCE_PROMPT_URL) {
      const r = await fetch(env.ENHANCE_PROMPT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.prompt) return { ...input, prompt: String(j.prompt) };
    }
  } catch {}
  const preface = 'Please generate a secure, minimal, audited smart contract. Prefer OpenZeppelin patterns. Enforce checks-effects-interactions. Provide clear constructor args.';
  return { ...input, prompt: `${preface}\n\n${input.prompt}` };
}

wss.on('connection', async (ws: WebSocket, req) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (pathname !== '/u/ws/blockchain-pipeline' && !pathname.startsWith('/u/ws/builder/')) { try { ws.close(1008, 'invalid_path'); } catch {} return; }
    const cookies = parseCookies(String(req.headers['cookie'] || ''));
    const access = cookies[ACCESS_COOKIE];
    if (!access) { try { ws.close(1008, 'unauthorized'); } catch {} return; }
    const sess = await findValidSessionByHash(tokenHash(String(access)));
    if (!sess) { try { ws.close(1008, 'unauthorized'); } catch {} return; }
    const ip = getClientIp(req.headers['x-forwarded-for'], (req.socket as any)?.remoteAddress) || 'unknown';

    if (pathname.startsWith('/u/ws/builder/')) {
      const projectId = decodeURIComponent(pathname.slice('/u/ws/builder/'.length) || '');
      if (!projectId) { try { ws.close(1008, 'bad_request'); } catch {} return; }
      if (!/^[0-9a-fA-F-]{32,40}$/.test(projectId)) { try { ws.close(1008, 'bad_request'); } catch {} return; }

      const ent = await getEntitlements(sess.user_id).catch(() => null);
      if (!ent?.pro_enabled) { try { ws.close(1008, 'forbidden'); } catch {} return; }

      const rlU = await allow(`rl:builder:ws:user:${sess.user_id}`, env.RL_BUILDER_READ_USER_PER_15M, 15 * 60);
      const rlI = await allow(`rl:builder:ws:ip:${ip}`, env.RL_BUILDER_READ_IP_PER_15M, 15 * 60);
      if (!rlU.ok || !rlI.ok) { try { ws.close(1008, 'rate_limited'); } catch {} return; }

      const proj = await getBuilderProjectById(sess.user_id, projectId);
      if (!proj) { try { ws.close(1008, 'not_found'); } catch {} return; }

      // Ensure shared heartbeat doesn't terminate builder clients
      (ws as any).isAlive = true;
      ws.on('pong', () => { (ws as any).isAlive = true; });

      function toBuilderWsUrl(path: string) {
        const baseHttp = String(env.FRONTEND_BUILDER_BASE_URL || '').replace(/\/+$/, '');
        const wsBase = baseHttp.startsWith('https://')
          ? `wss://${baseHttp.slice('https://'.length)}`
          : baseHttp.startsWith('http://')
            ? `ws://${baseHttp.slice('http://'.length)}`
            : baseHttp;
        const p = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
        return `${wsBase}${p}`;
      }

      const upstreamUrl = toBuilderWsUrl(`/ws/${encodeURIComponent(String(proj.fb_project_id || ''))}`);

      let closed = false;
      let upstream: WebSocket | null = null;
      let upstreamPing: ReturnType<typeof setInterval> | null = null;
      function closeBoth(code?: number, reason?: string) {
        if (closed) return;
        closed = true;
        if (upstreamPing) { clearInterval(upstreamPing); upstreamPing = null; }
        try { ws.close(code, reason); } catch {}
        try { upstream?.close(code, reason); } catch {}
      }

      upstream = new WebSocket(upstreamUrl);
      const pending: any[] = [];
      let pendingBytes = 0;
      const MAX_PENDING_MESSAGES = 200;
      const MAX_PENDING_BYTES = 1_000_000;
      let upstreamOpen = false;

      ws.on('close', (code, reason) => closeBoth(code, reason?.toString()));
      ws.on('error', () => closeBoth(1011, 'downstream_error'));

      ws.on('message', (data) => {
        if (closed) return;
        if (upstreamOpen) {
          try { upstream.send(data); } catch { closeBoth(1011, 'upstream_send_failed'); }
        } else {
          const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
          pendingBytes += size;
          pending.push(data);
          if (pending.length > MAX_PENDING_MESSAGES || pendingBytes > MAX_PENDING_BYTES) {
            closeBoth(1009, 'pending_overflow');
          }
        }
      });

      upstream.on('open', () => {
        upstreamOpen = true;
        upstreamPing = setInterval(() => {
          try {
            if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
            upstream.ping();
          } catch {}
        }, 25000);
        try {
          for (const m of pending.splice(0)) upstream.send(m);
          pendingBytes = 0;
        } catch {
          closeBoth(1011, 'upstream_flush_failed');
        }
      });

      upstream.on('message', (data) => {
        if (closed) return;
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        } catch {
          closeBoth(1011, 'downstream_send_failed');
        }
      });

      upstream.on('close', (code, reason) => closeBoth(code, reason?.toString()));
      upstream.on('error', () => closeBoth(1011, 'upstream_error'));
      return;
    }

    const rlU = await allow(`rl:wrapper:create:user:${sess.user_id}`, env.RL_PIPELINE_CREATE_PER_15M, 15 * 60);
    const rlI = await allow(`rl:wrapper:create:ip:${ip}`, env.RL_PIPELINE_CREATE_IP_PER_15M, 15 * 60);
    if (!rlU.ok || !rlI.ok) { try { ws.send(JSON.stringify({ event: 'error', data: { code: 'rate_limited' } })); ws.close(); } catch {} return; }

    try { Sentry.captureMessage('ws_connect', { level: 'info', extra: { userId: sess.user_id, ip } as any }); } catch {}
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
    ws.send(JSON.stringify({ event: 'ready', data: {} }));

    let closed = false;
    ws.on('close', () => { closed = true; try { Sentry.captureMessage('ws_close', { level: 'info', extra: { userId: sess.user_id, ip } as any }); } catch {} });
    ws.on('message', async (raw) => {
      if (closed) return;
      let msg: any = null; try { msg = JSON.parse(raw.toString()); } catch {}
      if (!msg || msg.type !== 'start' || !msg.payload) {
        try { ws.send(JSON.stringify({ event: 'error', data: { code: 'bad_request' } })); } catch {}
        return;
      }
      const schema = z.object({ prompt: z.string().min(4).max(20000), network: z.string().min(2).max(64), maxIters: z.number().min(1).max(50).optional(), filename: z.string().max(256).optional(), strictArgs: z.boolean().optional() });
      const parsed = schema.safeParse(msg.payload);
      if (!parsed.success) { try { ws.send(JSON.stringify({ event: 'error', data: { code: 'bad_request' } })); } catch {} return; }
      // Validate network is supported
      if (!isNetworkSupported(parsed.data.network)) {
        const supported = getEnabledNetworks().map(n => n.id);
        try { ws.send(JSON.stringify({ event: 'error', data: { code: 'unsupported_network', message: `Network '${parsed.data.network}' not supported. Supported: ${supported.join(', ')}` } })); ws.close(); } catch {}
        return;
      }

      try {
        const enhanced = await enhancePrompt({ prompt: parsed.data.prompt, network: parsed.data.network, filename: parsed.data.filename, strictArgs: parsed.data.strictArgs ?? null });
        ws.send(JSON.stringify({ event: 'prompt.enhanced', data: { prompt: enhanced.prompt } }));

        const body = { prompt: enhanced.prompt, network: enhanced.network, maxIters: parsed.data.maxIters, filename: parsed.data.filename, strictArgs: parsed.data.strictArgs } as any;
        const r = await fetch(`${env.EVI_V4_BASE_URL}/api/ai/pipeline`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { try { ws.send(JSON.stringify({ event: 'error', data: { code: 'upstream_error', status: r.status, body: j } })); ws.close(); } catch {} return; }
        const jobId = String(j?.jobId || j?.id || j?.data?.jobId || '');
        if (!jobId) { try { ws.send(JSON.stringify({ event: 'error', data: { code: 'no_job_id' } })); ws.close(); } catch {} return; }
        try { await attachUserJob({ jobId, userId: sess.user_id, type: 'pipeline', prompt: enhanced.prompt, filename: parsed.data.filename ?? null, network: enhanced.network }); } catch {}
        ws.send(JSON.stringify({ event: 'pipeline.created', data: { jobId } }));

        // Stream logs (SSE) -> WS
        const sseUrl = `${env.EVI_V4_BASE_URL}/api/job/${encodeURIComponent(jobId)}/logs/stream`;
        let ended = false;
        try {
          const resp = await fetch(sseUrl);
          if (!resp.ok || !resp.body) { try { Sentry.captureMessage('ws_stream_failed', { level: 'error', extra: { jobId, status: resp.status } as any }); } catch {}; ws.send(JSON.stringify({ event: 'error', data: { code: 'stream_failed', status: resp.status } })); ended = true; }
          if (!ended && resp.body) {
            const nodeStream = Readable.fromWeb(resp.body as any);
            let buffer = '';
            nodeStream.on('data', (chunk) => {
              if (closed) return;
              try {
                const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
                buffer += s;
                let idx = buffer.indexOf('\n\n');
                while (idx !== -1) {
                  const frame = buffer.slice(0, idx);
                  buffer = buffer.slice(idx + 2);
                  const lines = frame.split('\n');
                  let ev = 'message';
                  const dataLines: string[] = [];
                  for (const line of lines) {
                    if (line.startsWith('event:')) ev = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                  }
                  const dataStr = dataLines.join('\n');
                  let obj: any = null; try { obj = JSON.parse(dataStr); } catch {}
                  if (ev === 'log' && obj && typeof obj.msg === 'string') {
                    const magic = magicalFromLog(String(obj.msg), {});
                    ws.send(JSON.stringify({ event: 'log', data: obj }));
                    if (Array.isArray(magic) && magic.length) {
                      for (const m of magic) ws.send(JSON.stringify({ event: 'magic', data: m }));
                    }
                  } else {
                    ws.send(JSON.stringify({ event: ev || 'message', data: obj ?? dataStr }));
                  }
                  idx = buffer.indexOf('\n\n');
                }
              } catch {}
            });
            nodeStream.on('end', async () => {
              if (closed) return;
              ended = true;
              // After stream end, fetch artifacts + audit + compliance via our wrappers, fallback to V4 directly if wrappers do not return 200
              try {
                const base = `http://localhost:${env.PORT}`;
                async function getJson(u: string, cookieHeader?: string) { try { const rr = await fetch(u, cookieHeader ? { headers: { cookie: cookieHeader } as any } : undefined); const jj = await rr.json().catch(() => null); return { status: rr.status, body: jj }; } catch { return { status: 0, body: null }; } }
                const cookieHeader = `${ACCESS_COOKIE}=${String(access)}`;
                const art = await getJson(`${base}/u/proxy/artifacts?jobId=${encodeURIComponent(jobId)}`, cookieHeader);
                if (art.status === 200) { ws.send(JSON.stringify({ event: 'artifacts', data: art.body })); } else {
                  const a2 = await getJson(`${env.EVI_V4_BASE_URL}/api/artifacts?jobId=${encodeURIComponent(jobId)}`);
                  if (a2.status === 200) ws.send(JSON.stringify({ event: 'artifacts', data: a2.body }));
                }
                const audit = await getJson(`${base}/u/proxy/artifacts/audit?jobId=${encodeURIComponent(jobId)}`, cookieHeader);
                if (audit.status === 200) { ws.send(JSON.stringify({ event: 'audit', data: audit.body })); } else {
                  const ad2 = await getJson(`${env.EVI_V4_BASE_URL}/api/artifacts/audit?jobId=${encodeURIComponent(jobId)}`);
                  if (ad2.status === 200) ws.send(JSON.stringify({ event: 'audit', data: ad2.body }));
                }
                const comp = await getJson(`${base}/u/proxy/artifacts/compliance?jobId=${encodeURIComponent(jobId)}`, cookieHeader);
                if (comp.status === 200) { ws.send(JSON.stringify({ event: 'compliance', data: comp.body })); } else {
                  const cp2 = await getJson(`${env.EVI_V4_BASE_URL}/api/artifacts/compliance?jobId=${encodeURIComponent(jobId)}`);
                  if (cp2.status === 200) ws.send(JSON.stringify({ event: 'compliance', data: cp2.body }));
                }
                // Auto-verify the deployed contract
                try {
                  console.log(JSON.stringify({ level: 'info', msg: 'ws_auto_verify_trigger', jobId }));
                  const deployStatus = await checkJobDeploymentStatus(jobId);
                  console.log(JSON.stringify({ level: 'info', msg: 'ws_deploy_status', jobId, deployed: deployStatus.deployed, address: deployStatus.address, network: deployStatus.network, fqName: deployStatus.fqName }));
                  if (deployStatus.deployed && deployStatus.network) {
                    ws.send(JSON.stringify({ event: 'verification.started', data: { jobId, network: deployStatus.network, address: deployStatus.address } }));
                    ws.send(JSON.stringify({ event: 'log', data: { msg: 'Stage: verify', level: 'info', i: Date.now() } }));
                    ws.send(JSON.stringify({ event: 'log', data: { msg: `Starting auto-verification on ${deployStatus.network}...`, level: 'info', i: Date.now() + 1 } }));
                    const verifyResult = await autoVerifyContract(jobId, deployStatus.network, deployStatus.fqName);
                    console.log(JSON.stringify({ level: 'info', msg: 'ws_verify_result', jobId, ...verifyResult }));
                    ws.send(JSON.stringify({ event: 'verification.complete', data: { jobId, ...verifyResult } }));
                    if (verifyResult.ok) {
                      ws.send(JSON.stringify({ event: 'log', data: { msg: `✅ Contract verified successfully on ${deployStatus.network}`, level: 'info', i: Date.now() + 2 } }));
                      try { await upsertJobCache({ jobId, state: 'completed', verified: true }); } catch {}
                    } else {
                      ws.send(JSON.stringify({ event: 'log', data: { msg: `⚠️ Contract verification failed: ${verifyResult.error || 'unknown error'}`, level: 'warn', i: Date.now() + 2 } }));
                    }
                  } else {
                    console.log(JSON.stringify({ level: 'warn', msg: 'ws_verify_skip', jobId, reason: 'not_deployed_or_no_network' }));
                    ws.send(JSON.stringify({ event: 'log', data: { msg: '⚠️ Skipping verification: contract deploy status not confirmed', level: 'warn', i: Date.now() } }));
                  }
                } catch (verifyErr: any) {
                  console.error(JSON.stringify({ level: 'error', msg: 'ws_auto_verify_error', jobId, error: verifyErr?.message }));
                }
              } catch {}
              try { ws.send(JSON.stringify({ event: 'complete', data: { jobId } })); } catch {}
              try { ws.close(); } catch {}
            });
            nodeStream.on('error', () => { if (closed) return; try { Sentry.captureMessage('ws_stream_error', { level: 'error', extra: { jobId } as any }); } catch {}; try { ws.send(JSON.stringify({ event: 'error', data: { code: 'stream_error' } })); } catch {}; try { ws.close(); } catch {}; });
          }
        } catch {
          try { Sentry.captureMessage('ws_fetch_failed', { level: 'error', extra: { jobId } as any }); } catch {}
          try { ws.send(JSON.stringify({ event: 'error', data: { code: 'fetch_failed' } })); } catch {}
          try { ws.close(); } catch {}
        }
      } catch (e: any) {
        try { ws.send(JSON.stringify({ event: 'error', data: { code: 'internal', message: e?.message } })); } catch {}
        try { ws.close(); } catch {}
      }
    });
  } catch {
    try { ws.close(); } catch {}
  }
});

if (env.SENTRY_DSN) {
  app.use(Sentry.expressErrorHandler({}));
}

app.use((err: any, req: Request, res: Response, _next: any) => {
  const log = { level: 'error', msg: 'unhandled_error', method: req.method, url: (req as any).originalUrl || req.url, error: { message: err?.message, stack: err?.stack } };
  console.error(JSON.stringify(log));
  const msg = String(err?.message || '');
  const isDbTimeout = msg.toLowerCase().includes('connection timeout') || msg.includes('Connection terminated') || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || err?.code === '57P03';
  if (isDbTimeout) return res.status(503).json({ ok: false, error: { code: 'db_unavailable' } });
  return res.status(500).json({ ok: false, error: { code: 'internal_error' } });
});
