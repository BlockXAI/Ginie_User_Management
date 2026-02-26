import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config();

 function cleanOriginPart(s: string): string {
   const t = String(s || '').trim();
   const unquoted = t.replace(/^['"]/, '').replace(/['"]$/, '');
   return unquoted.replace(/\/+$/, '');
 }

function normalizeGeminiModelName(model: string) {
  const m = String(model || '').trim();
  if (!m) return 'gemini-2.0-flash';
  if (m.endsWith('-exp')) return m.slice(0, -4);
  return m;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 8080),
  APP_URL: cleanOriginPart(process.env.APP_URL || 'http://localhost:3000'),
  APP_URLS: (process.env.APP_URLS || '')
    .split(',')
    .map((s) => cleanOriginPart(s))
    .filter(Boolean),
  DATABASE_URL: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || '',
  REDIS_URL: process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || '',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-only-long-random',
  OTP_PROVIDER_URL: process.env.OTP_PROVIDER_URL || '',
  OTP_PROVIDER_API_KEY: process.env.OTP_PROVIDER_API_KEY || '',
  OTP_PROVIDER_MODE: process.env.OTP_PROVIDER_MODE || 'dev', // dev|prod
  // Looser defaults in development for convenience
  RL_OTP_SEND_PER_15M: Number(process.env.RL_OTP_SEND_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 20 : 5)),
  RL_OTP_SEND_IP_PER_15M: Number(process.env.RL_OTP_SEND_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 100 : 20)),
  RL_OTP_VERIFY_PER_15M: Number(process.env.RL_OTP_VERIFY_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 30 : 10)),
  RL_PIPELINE_CREATE_PER_15M: Number(process.env.RL_PIPELINE_CREATE_PER_15M || 10),
  RL_PIPELINE_CREATE_IP_PER_15M: Number(process.env.RL_PIPELINE_CREATE_IP_PER_15M || 50),
  RL_BUILDER_CREATE_PER_15M: Number(process.env.RL_BUILDER_CREATE_PER_15M || 10),
  RL_BUILDER_CREATE_IP_PER_15M: Number(process.env.RL_BUILDER_CREATE_IP_PER_15M || 50),
  RL_BUILDER_READ_USER_PER_15M: Number(process.env.RL_BUILDER_READ_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 5000 : 600)),
  RL_BUILDER_READ_IP_PER_15M: Number(process.env.RL_BUILDER_READ_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 15000 : 2000)),
  RL_WRAPPER_READ_USER_PER_15M: Number(process.env.RL_WRAPPER_READ_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 5000 : 600)),
  RL_WRAPPER_READ_IP_PER_15M: Number(process.env.RL_WRAPPER_READ_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 15000 : 2000)),
  RL_KEYS_REDEEM_PER_15M: Number(process.env.RL_KEYS_REDEEM_PER_15M || 10),
  RL_KEYS_REDEEM_IP_PER_15M: Number(process.env.RL_KEYS_REDEEM_IP_PER_15M || 50),
  // Admin endpoint rate limits (env-configurable, higher in dev)
  RL_ADMIN_KEYS_MINT_USER_PER_15M: Number(process.env.RL_ADMIN_KEYS_MINT_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 500 : 60)),
  RL_ADMIN_KEYS_MINT_IP_PER_15M: Number(process.env.RL_ADMIN_KEYS_MINT_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 1000 : 200)),
  RL_ADMIN_KEYS_REVOKE_USER_PER_15M: Number(process.env.RL_ADMIN_KEYS_REVOKE_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 1000 : 120)),
  RL_ADMIN_KEYS_REVOKE_IP_PER_15M: Number(process.env.RL_ADMIN_KEYS_REVOKE_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 1500 : 300)),
  RL_ADMIN_ENTITLEMENTS_USER_PER_15M: Number(process.env.RL_ADMIN_ENTITLEMENTS_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 1000 : 120)),
  RL_ADMIN_ENTITLEMENTS_IP_PER_15M: Number(process.env.RL_ADMIN_ENTITLEMENTS_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 1500 : 300)),
  RL_ADMIN_DOWNGRADE_USER_PER_15M: Number(process.env.RL_ADMIN_DOWNGRADE_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 500 : 60)),
  RL_ADMIN_DOWNGRADE_IP_PER_15M: Number(process.env.RL_ADMIN_DOWNGRADE_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 1000 : 200)),
  RL_ADMIN_LOOKUP_USER_PER_15M: Number(process.env.RL_ADMIN_LOOKUP_USER_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 2000 : 300)),
  RL_ADMIN_LOOKUP_IP_PER_15M: Number(process.env.RL_ADMIN_LOOKUP_IP_PER_15M || ((process.env.NODE_ENV || 'development') === 'development' ? 4000 : 600)),
  // Brevo / Email
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'Ginie',
  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS || 'no-reply@ginie.xyz',
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || 'support@ginie.xyz',
  BREVO_TEMPLATE_ID_OTP: process.env.BREVO_TEMPLATE_ID_OTP ? Number(process.env.BREVO_TEMPLATE_ID_OTP) : undefined,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '',
  EVI_BASE_URL: process.env.EVI_BASE_URL || 'https://evi-wallet-production.up.railway.app',
  FRONTEND_BUILDER_BASE_URL: process.env.FRONTEND_BUILDER_BASE_URL || process.env.FB_BASE_URL || 'http://localhost:8000',
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  SENTRY_ENV: process.env.SENTRY_ENV || '',
  SENTRY_SAMPLE_RATE: process.env.SENTRY_SAMPLE_RATE || '',
  TRUST_PROXY: process.env.TRUST_PROXY || '',
  ENHANCE_PROMPT_ENABLED: process.env.ENHANCE_PROMPT_ENABLED || '',
  ENHANCE_PROMPT_URL: process.env.ENHANCE_PROMPT_URL || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.NEXT_OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  GEMINI_API_KEY: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
  GEMINI_MODEL: normalizeGeminiModelName(process.env.GEMINI_MODEL || 'gemini-2.0-flash'),
  EVI_V4_BASE_URL: process.env.EVI_V4_BASE_URL || process.env.EVI_BASE_URL || 'https://evi-wallet-production.up.railway.app',
  PIPELINE_ALLOW_FREE: process.env.PIPELINE_ALLOW_FREE || '',
  // Cookies & cross-site settings
  COOKIES_CROSS_SITE: process.env.COOKIES_CROSS_SITE || '', // '1'|'true' enables SameSite=None + Secure
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || '', // optional e.g., .yourdomain.com
  SEED_ADMIN_EMAILS: process.env.SEED_ADMIN_EMAILS || 'arpit2005singh@gmail.com',
  // Service-to-service secret: Frontend_Builder → user-api (for DApp orchestration)
  USERAPI_SERVICE_SECRET: process.env.USERAPI_SERVICE_SECRET || '',
};

function validateEnv() {
  const isDev = String(env.NODE_ENV) === 'development';
  const errs: string[] = [];
  const warns: string[] = [];

  if (!['development', 'production', 'test', 'staging'].includes(String(env.NODE_ENV))) {
    warns.push(`NODE_ENV=${env.NODE_ENV} is unusual; expected development|production|staging|test`);
  }
  if (!env.APP_URL && (!Array.isArray(env.APP_URLS) || env.APP_URLS.length === 0)) {
    errs.push('APP_URL or APP_URLS is required (frontend origin(s) for CORS)');
  }
  if (!isDev) {
    if (!env.DATABASE_URL) errs.push('DATABASE_URL is required in production');
    if (!env.REDIS_URL) errs.push('REDIS_URL is required in production');
    if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) errs.push('SESSION_SECRET must be at least 32 chars in production');
  } else {
    if (!env.DATABASE_URL) warns.push('DATABASE_URL is empty (dev) — set to local Postgres to persist data');
    if (!env.REDIS_URL) warns.push('REDIS_URL is empty (dev) — set to local Redis for rate limits/sessions');
  }

  if (!['dev', 'prod'].includes(String(env.OTP_PROVIDER_MODE))) {
    errs.push(`OTP_PROVIDER_MODE must be 'dev' or 'prod' (got ${env.OTP_PROVIDER_MODE})`);
  }
  if (!isDev && String(env.OTP_PROVIDER_MODE) === 'prod') {
    if (!env.BREVO_API_KEY) errs.push('BREVO_API_KEY is required when OTP_PROVIDER_MODE=prod (for email delivery)');
    if (!env.EMAIL_FROM_ADDRESS) errs.push('EMAIL_FROM_ADDRESS is required when OTP_PROVIDER_MODE=prod');
  }

  if (env.TURNSTILE_SECRET_KEY && String(env.TURNSTILE_SECRET_KEY).length < 10) {
    warns.push('TURNSTILE_SECRET_KEY is set but looks invalid (length)');
  }

  const rateLimits = [
    env.RL_OTP_SEND_PER_15M,
    env.RL_OTP_SEND_IP_PER_15M,
    env.RL_OTP_VERIFY_PER_15M,
    env.RL_PIPELINE_CREATE_PER_15M,
    env.RL_PIPELINE_CREATE_IP_PER_15M,
    env.RL_WRAPPER_READ_USER_PER_15M,
    env.RL_WRAPPER_READ_IP_PER_15M,
    env.RL_KEYS_REDEEM_PER_15M,
    env.RL_KEYS_REDEEM_IP_PER_15M,
    env.RL_ADMIN_KEYS_MINT_USER_PER_15M,
    env.RL_ADMIN_KEYS_MINT_IP_PER_15M,
    env.RL_ADMIN_KEYS_REVOKE_USER_PER_15M,
    env.RL_ADMIN_KEYS_REVOKE_IP_PER_15M,
    env.RL_ADMIN_ENTITLEMENTS_USER_PER_15M,
    env.RL_ADMIN_ENTITLEMENTS_IP_PER_15M,
    env.RL_ADMIN_DOWNGRADE_USER_PER_15M,
    env.RL_ADMIN_DOWNGRADE_IP_PER_15M,
    env.RL_ADMIN_LOOKUP_USER_PER_15M,
    env.RL_ADMIN_LOOKUP_IP_PER_15M,
  ];
  if (rateLimits.some((n) => isNaN(Number(n)) || Number(n) < 0)) {
    errs.push('One or more rate limit envs are invalid (must be non-negative numbers)');
  }

  if (env.SENTRY_SAMPLE_RATE && (Number(env.SENTRY_SAMPLE_RATE) < 0 || Number(env.SENTRY_SAMPLE_RATE) > 1)) {
    warns.push('SENTRY_SAMPLE_RATE should be between 0 and 1');
  }

  if (String(env.ENHANCE_PROMPT_ENABLED) === '1' || String(env.ENHANCE_PROMPT_ENABLED).toLowerCase() === 'true') {
    const hasHosted = !!env.ENHANCE_PROMPT_URL;
    const hasOpenAI = !!env.OPENAI_API_KEY;
    const hasGemini = !!env.GEMINI_API_KEY;
    if (!hasHosted && !hasOpenAI && !hasGemini) {
      warns.push('ENHANCE_PROMPT_ENABLED is set but no ENHANCE_PROMPT_URL/OPENAI_API_KEY/GEMINI_API_KEY provided');
    }
  }

  if (errs.length) {
    const msg = `Invalid configuration:\n- ${errs.join('\n- ')}`;
    throw new Error(msg);
  }
  if (warns.length) {
    for (const w of warns) console.warn(`[config warn] ${w}`);
  }
}

validateEnv();
