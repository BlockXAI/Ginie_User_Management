import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { env } from './env.js';
import { randomToken, tokenHash } from './utils.js';

const PG_POOL_MAX = Number(process.env.PG_POOL_MAX || (String(env.NODE_ENV) === 'development' ? 5 : 10));
const PG_POOL_IDLE_TIMEOUT_MS = Number(process.env.PG_POOL_IDLE_TIMEOUT_MS || 30000);
const PG_POOL_CONN_TIMEOUT_MS = Number(process.env.PG_POOL_CONN_TIMEOUT_MS || 30000);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: Number.isFinite(PG_POOL_MAX) && PG_POOL_MAX > 0 ? PG_POOL_MAX : 5,
  idleTimeoutMillis: Number.isFinite(PG_POOL_IDLE_TIMEOUT_MS) && PG_POOL_IDLE_TIMEOUT_MS > 0 ? PG_POOL_IDLE_TIMEOUT_MS : 30000,
  connectionTimeoutMillis: Number.isFinite(PG_POOL_CONN_TIMEOUT_MS) && PG_POOL_CONN_TIMEOUT_MS > 0 ? PG_POOL_CONN_TIMEOUT_MS : 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

let schemaInitPromise: Promise<void> | null = null;
let schemaInitDone = false;

// Handle pool errors to prevent unhandled rejections
pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'db.pool.error', error: err?.message || String(err) }));
});

// Retry wrapper for transient database errors (ECONNRESET, etc.)
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isTransient = err?.code === 'ECONNRESET' || msg.includes('ECONNRESET') ||
        err?.code === 'ETIMEDOUT' || msg.toLowerCase().includes('connection timeout') ||
        msg.includes('Connection terminated') ||
        err?.code === 'ECONNREFUSED' ||
        err?.code === '57P01' || // admin_shutdown
        err?.code === '57P02' || // crash_shutdown
        err?.code === '57P03';   // cannot_connect_now
      if (!isTransient || i === retries - 1) throw err;
      console.warn(JSON.stringify({ level: 'warn', msg: 'db.retry', attempt: i + 1, error: err?.message }));
      const base = delayMs * Math.pow(2, i);
      const jitter = Math.floor(Math.random() * 100);
      await new Promise(r => setTimeout(r, base + jitter));
    }
  }
  throw lastErr;
}

// Safe query with retry
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  return withRetry(async () => {
    const result = await pool.query(text, params);
    return result.rows as T[];
  });
}

// Safe single row query with retry
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function initSchema() {
  if (schemaInitDone) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Extensions
      await client.query(`CREATE EXTENSION IF NOT EXISTS citext;`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email CITEXT UNIQUE NOT NULL,
          email_verified_at TIMESTAMP NULL,
          display_name TEXT NULL,
          wallet_address TEXT NULL,
          role TEXT NOT NULL DEFAULT 'normal',
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT now(),
          updated_at TIMESTAMP NOT NULL DEFAULT now()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_hash TEXT UNIQUE NOT NULL,
          refresh_hash TEXT UNIQUE NULL,
          expires_at TIMESTAMP NOT NULL,
          device_info JSONB NOT NULL DEFAULT '{}'::jsonb,
          ip INET NULL,
          last_active_at TIMESTAMP NULL,
          revoked_at TIMESTAMP NULL
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS entitlements (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          pro_enabled BOOLEAN NOT NULL DEFAULT false,
          wallet_deployments BOOLEAN NOT NULL DEFAULT false,
          history_export BOOLEAN NOT NULL DEFAULT false,
          chat_agents BOOLEAN NOT NULL DEFAULT false,
          hosted_frontend BOOLEAN NOT NULL DEFAULT false,
          limits JSONB NOT NULL DEFAULT '{}'::jsonb
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS premium_keys (
          id UUID PRIMARY KEY,
          secret_hash TEXT NOT NULL,
          issued_by_admin UUID NOT NULL REFERENCES users(id),
          status TEXT NOT NULL,
          redeemed_by_user UUID NULL REFERENCES users(id),
          expires_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT now()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_premium_keys_status ON premium_keys(status);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_premium_keys_expires_at ON premium_keys(expires_at);`);
      await client.query(`ALTER TABLE premium_keys ADD COLUMN IF NOT EXISTS lookup_hash TEXT UNIQUE NULL;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_jobs (
          job_id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'pipeline',
          prompt TEXT NULL,
          filename TEXT NULL,
          network TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT now()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_jobs_user_created_at ON user_jobs(user_id, created_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_jobs_type_created_at ON user_jobs(type, created_at DESC);`);
      await client.query(`ALTER TABLE user_jobs ADD COLUMN IF NOT EXISTS title TEXT NULL;`);
      await client.query(`ALTER TABLE user_jobs ADD COLUMN IF NOT EXISTS description TEXT NULL;`);
      await client.query(`ALTER TABLE user_jobs ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;`);
      await client.query(`ALTER TABLE user_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();`);
      await client.query(`ALTER TABLE user_jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;`);
      await client.query(`ALTER TABLE user_jobs ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMP NULL;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS job_cache (
          job_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          address TEXT NULL,
          fq_name TEXT NULL,
          constructor_args JSONB NOT NULL DEFAULT '[]'::jsonb,
          verified BOOLEAN NOT NULL DEFAULT false,
          explorer_url TEXT NULL,
          completed_at TIMESTAMP NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT now()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_job_cache_state ON job_cache(state);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_job_cache_updated_at ON job_cache(updated_at DESC);`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY,
          user_id UUID NULL REFERENCES users(id),
          event TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT now()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_event_created ON audit_logs(event, created_at DESC);`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_avatars (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content_type TEXT NOT NULL,
          bytes BYTEA NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT now()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_avatars_user_created ON user_avatars(user_id, created_at DESC);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS builder_projects (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          fb_project_id TEXT NOT NULL,
          title TEXT NULL,
          status TEXT NULL,
          vercel_url TEXT NULL,
          github_url TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT now(),
          deleted_at TIMESTAMP NULL,
          UNIQUE(user_id, fb_project_id)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_builder_projects_user_created_at ON builder_projects(user_id, created_at DESC);`);
      // DApp integration: contract info cached on builder_projects for unified view
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'frontend';`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_address TEXT;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_network TEXT;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_chain_id INTEGER;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_explorer_url TEXT;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_verified BOOLEAN DEFAULT FALSE;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_job_id TEXT;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_name TEXT;`);
      await client.query(`ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS contract_abi JSONB;`);
      await client.query('COMMIT');
      schemaInitDone = true;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  })().finally(() => {
    schemaInitPromise = null;
  });

  return schemaInitPromise;
}

// --- Jobs helpers: ownership, counts, metadata, soft-delete ---
export async function userOwnsJob(userId: string, jobId: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM user_jobs WHERE user_id = $1 AND job_id = $2 AND deleted_at IS NULL', [userId, jobId]);
  return (rowCount || 0) > 0;
}

export type BuilderProjectRow = {
  id: string;
  user_id: string;
  fb_project_id: string;
  title: string | null;
  status: string | null;
  vercel_url: string | null;
  github_url: string | null;
  project_type: string;
  contract_address: string | null;
  contract_network: string | null;
  contract_chain_id: number | null;
  contract_explorer_url: string | null;
  contract_verified: boolean;
  contract_job_id: string | null;
  contract_name: string | null;
  contract_abi: any | null;
  created_at: Date;
  deleted_at: Date | null;
};

export async function createBuilderProjectMapping(userId: string, fbProjectId: string, title?: string | null, projectType?: string): Promise<BuilderProjectRow> {
  const q = `
    INSERT INTO builder_projects (user_id, fb_project_id, title, project_type, deleted_at)
    VALUES ($1, $2, $3, $4, NULL)
    ON CONFLICT (user_id, fb_project_id)
    DO UPDATE SET
      title = COALESCE(builder_projects.title, EXCLUDED.title),
      project_type = COALESCE(EXCLUDED.project_type, builder_projects.project_type),
      deleted_at = NULL
    RETURNING *
  `;
  const { rows } = await pool.query(q, [userId, fbProjectId, typeof title === 'undefined' ? null : title, projectType || 'frontend']);
  return rows[0] as BuilderProjectRow;
}

export async function listBuilderProjects(userId: string, limit = 50, projectType?: string): Promise<BuilderProjectRow[]> {
  const lim = Math.min(Math.max(limit, 1), 200);
  const args: any[] = [userId];
  let where = 'user_id = $1 AND deleted_at IS NULL';
  if (projectType) { args.push(projectType); where += ` AND project_type = $${args.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM builder_projects WHERE ${where} ORDER BY created_at DESC LIMIT ${lim}`,
    args
  );
  return rows as BuilderProjectRow[];
}

export async function getBuilderProjectById(userId: string, id: string): Promise<BuilderProjectRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM builder_projects WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [userId, id]
  );
  return (rows[0] as BuilderProjectRow) || null;
}

export async function getBuilderProjectByFbId(userId: string, fbProjectId: string): Promise<BuilderProjectRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM builder_projects WHERE user_id = $1 AND fb_project_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [userId, fbProjectId]
  );
  return (rows[0] as BuilderProjectRow) || null;
}

export async function softDeleteBuilderProject(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE builder_projects SET deleted_at = now() WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL',
    [userId, id]
  );
  return (rowCount || 0) > 0;
}

export async function updateBuilderProjectCache(
  id: string,
  patch: {
    title?: string | null; status?: string | null; vercel_url?: string | null; github_url?: string | null;
    contract_address?: string | null; contract_network?: string | null; contract_chain_id?: number | null;
    contract_explorer_url?: string | null; contract_verified?: boolean; contract_job_id?: string | null;
    contract_name?: string | null; contract_abi?: any | null; project_type?: string;
  }
): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [id];
  let idx = 1;
  if (typeof patch.title !== 'undefined') { fields.push(`title = $${++idx}`); values.push(patch.title); }
  if (typeof patch.status !== 'undefined') { fields.push(`status = $${++idx}`); values.push(patch.status); }
  if (typeof patch.vercel_url !== 'undefined') { fields.push(`vercel_url = $${++idx}`); values.push(patch.vercel_url); }
  if (typeof patch.github_url !== 'undefined') { fields.push(`github_url = $${++idx}`); values.push(patch.github_url); }
  if (typeof patch.project_type !== 'undefined') { fields.push(`project_type = $${++idx}`); values.push(patch.project_type); }
  if (typeof patch.contract_address !== 'undefined') { fields.push(`contract_address = $${++idx}`); values.push(patch.contract_address); }
  if (typeof patch.contract_network !== 'undefined') { fields.push(`contract_network = $${++idx}`); values.push(patch.contract_network); }
  if (typeof patch.contract_chain_id !== 'undefined') { fields.push(`contract_chain_id = $${++idx}`); values.push(patch.contract_chain_id); }
  if (typeof patch.contract_explorer_url !== 'undefined') { fields.push(`contract_explorer_url = $${++idx}`); values.push(patch.contract_explorer_url); }
  if (typeof patch.contract_verified === 'boolean') { fields.push(`contract_verified = $${++idx}`); values.push(patch.contract_verified); }
  if (typeof patch.contract_job_id !== 'undefined') { fields.push(`contract_job_id = $${++idx}`); values.push(patch.contract_job_id); }
  if (typeof patch.contract_name !== 'undefined') { fields.push(`contract_name = $${++idx}`); values.push(patch.contract_name); }
  if (typeof patch.contract_abi !== 'undefined') { fields.push(`contract_abi = $${++idx}`); values.push(patch.contract_abi ? JSON.stringify(patch.contract_abi) : null); }
  if (fields.length === 0) return true;
  const q = `UPDATE builder_projects SET ${fields.join(', ')} WHERE id = $1 AND deleted_at IS NULL`;
  const { rowCount } = await pool.query(q, values);
  return (rowCount || 0) > 0;
}

export async function countUserJobsSummary(userId: string): Promise<{ total: number; today: number }>{
  const q = `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today
    FROM user_jobs
    WHERE user_id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await pool.query(q, [userId]);
  const r = rows[0] || { total: 0, today: 0 } as any;
  return { total: Number(r.total || 0), today: Number(r.today || 0) };
}

export async function countUserJobsSince(userId: string, since: Date): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM user_jobs WHERE user_id = $1 AND created_at >= $2 AND deleted_at IS NULL', [userId, since]);
  return Number(rows?.[0]?.c || 0);
}

export async function updateJobMeta(userId: string, jobId: string, params: { title?: string | null; description?: string | null; tags?: any[] | null }): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [userId, jobId];
  let idx = 2;
  if (typeof params.title !== 'undefined') { fields.push(`title = $${++idx}`); values.push(params.title); }
  if (typeof params.description !== 'undefined') { fields.push(`description = $${++idx}`); values.push(params.description); }
  if (typeof params.tags !== 'undefined') { fields.push(`tags = $${++idx}`); values.push(JSON.stringify(params.tags ?? [])); }
  if (fields.length === 0) return true;
  fields.push('updated_at = now()');
  const q = `UPDATE user_jobs SET ${fields.join(', ')} WHERE user_id = $1 AND job_id = $2 AND deleted_at IS NULL`;
  const { rowCount } = await pool.query(q, values);
  return (rowCount || 0) > 0;
}

export async function softDeleteUserJob(userId: string, jobId: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE user_jobs SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND job_id = $2 AND deleted_at IS NULL', [userId, jobId]);
  return (rowCount || 0) > 0;
}

export async function listUserAuditLogs(userId: string, limit = 50): Promise<Array<{ id: string; event: string; metadata: any; created_at: Date }>> {
  const lim = Math.min(Math.max(limit, 1), 200);
  const { rows } = await pool.query(
    `SELECT id, event, metadata, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${lim}`,
    [userId]
  );
  return rows as Array<{ id: string; event: string; metadata: any; created_at: Date }>;
}

export async function findPremiumKeyById(id: string): Promise<{ id: string; secret_hash: string; lookup_hash: string | null; issued_by_admin: string; status: string; redeemed_by_user: string | null; expires_at: Date | null; created_at: Date } | undefined> {
  const { rows } = await pool.query(
    'SELECT id, secret_hash, lookup_hash, issued_by_admin, status, redeemed_by_user, expires_at, created_at FROM premium_keys WHERE id = $1 LIMIT 1',
    [id]
  );
  return rows[0] as { id: string; secret_hash: string; lookup_hash: string | null; issued_by_admin: string; status: string; redeemed_by_user: string | null; expires_at: Date | null; created_at: Date } | undefined;
}

// --- Premium Keys ---
export async function createPremiumKey(params: { issuedByAdmin: string; expiresAt?: Date | null }): Promise<{ id: string; key: string }>{
  const id = randomUUID();
  const key = randomToken(32);
  const argon2 = (await import('argon2')).default;
  const secretHash = await argon2.hash(key);
  const lookupHash = tokenHash(key);
  const q = `
    INSERT INTO premium_keys (id, secret_hash, lookup_hash, issued_by_admin, status, redeemed_by_user, expires_at)
    VALUES ($1, $2, $3, $4, 'minted', NULL, $5)
    RETURNING id
  `;
  await pool.query(q, [id, secretHash, lookupHash, params.issuedByAdmin, params.expiresAt ?? null]);
  return { id, key };
}

export async function findPremiumKeyByLookupHash(lookupHash: string): Promise<{ id: string; secret_hash: string; lookup_hash: string | null; issued_by_admin: string; status: string; redeemed_by_user: string | null; expires_at: Date | null; created_at: Date } | undefined> {
  const { rows } = await pool.query(
    'SELECT id, secret_hash, lookup_hash, issued_by_admin, status, redeemed_by_user, expires_at, created_at FROM premium_keys WHERE lookup_hash = $1 LIMIT 1',
    [lookupHash]
  );
  return rows[0] as { id: string; secret_hash: string; lookup_hash: string | null; issued_by_admin: string; status: string; redeemed_by_user: string | null; expires_at: Date | null; created_at: Date } | undefined;
}

export async function redeemPremiumKeyAndGrantPro(params: { lookupHash: string; userId: string }): Promise<{ ok: true; keyId: string } | { ok: false; code: 'invalid_key' | 'already_used' }>{
  return withRetry(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, status, expires_at
         FROM premium_keys
         WHERE lookup_hash = $1
         LIMIT 1
         FOR UPDATE`,
        [params.lookupHash]
      );
      const row = rows[0] as { id: string; status: string; expires_at: Date | null } | undefined;
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'invalid_key' };
      }
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'invalid_key' };
      }
      if (row.status !== 'minted') {
        await client.query('ROLLBACK');
        return { ok: false, code: 'already_used' };
      }

      await client.query(
        `UPDATE premium_keys
         SET status = 'redeemed', redeemed_by_user = $2
         WHERE id = $1 AND status = 'minted'`,
        [row.id, params.userId]
      );

      await client.query(
        `UPDATE users
         SET role = CASE WHEN role = 'admin' THEN role ELSE 'pro' END,
             updated_at = now()
         WHERE id = $1`,
        [params.userId]
      );

      await client.query(
        `INSERT INTO entitlements (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [params.userId]
      );
      await client.query(
        `UPDATE entitlements
         SET pro_enabled = true
         WHERE user_id = $1`,
        [params.userId]
      );

      await client.query('COMMIT');
      return { ok: true, keyId: row.id };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  });
}

export async function markPremiumKeyRedeemed(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE premium_keys SET status = 'redeemed', redeemed_by_user = $2 WHERE id = $1 AND status = 'minted'`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updatePremiumKeyStatus(id: string, status: 'minted' | 'revoked' | 'redeemed'): Promise<void> {
  await pool.query('UPDATE premium_keys SET status = $2 WHERE id = $1', [id, status]);
}

export async function listPremiumKeys(opts?: { status?: 'minted' | 'revoked' | 'redeemed'; limit?: number }) {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const args: any[] = [];
  let where = '1=1';
  if (opts?.status) { where = 'status = $1'; args.push(opts.status); }
  const q = `
    SELECT id, issued_by_admin, status, redeemed_by_user, expires_at, created_at
    FROM premium_keys
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  const { rows } = await pool.query(q, args);
  return rows as Array<{ id: string; issued_by_admin: string; status: string; redeemed_by_user: string | null; expires_at: Date | null; created_at: Date }>;
}

// --- Users & Entitlements updates ---
export async function setUserRoleAndEntitlements(userId: string, params: {
  role?: 'normal' | 'pro' | 'admin';
  pro_enabled?: boolean;
  wallet_deployments?: boolean;
  history_export?: boolean;
  chat_agents?: boolean;
  hosted_frontend?: boolean;
  limits?: any;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (params.role) {
      await client.query('UPDATE users SET role = $2, updated_at = now() WHERE id = $1', [userId, params.role]);
    }
    await client.query(
      `INSERT INTO entitlements (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (typeof params.pro_enabled === 'boolean') { fields.push(`pro_enabled = $${++idx}`); values.push(params.pro_enabled); }
    if (typeof params.wallet_deployments === 'boolean') { fields.push(`wallet_deployments = $${++idx}`); values.push(params.wallet_deployments); }
    if (typeof params.history_export === 'boolean') { fields.push(`history_export = $${++idx}`); values.push(params.history_export); }
    if (typeof params.chat_agents === 'boolean') { fields.push(`chat_agents = $${++idx}`); values.push(params.chat_agents); }
    if (typeof params.hosted_frontend === 'boolean') { fields.push(`hosted_frontend = $${++idx}`); values.push(params.hosted_frontend); }
    if (typeof params.limits !== 'undefined') { fields.push(`limits = $${++idx}`); values.push(JSON.stringify(params.limits)); }
    if (fields.length > 0) {
      const q = `UPDATE entitlements SET ${fields.join(', ')} WHERE user_id = $1`;
      await client.query(q, [userId, ...values]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export async function upsertUserByEmail(email: string): Promise<{ id: string; email: string; role: string; display_name: string | null }>{
  const id = randomUUID();
  const q = `
    INSERT INTO users (id, email)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET updated_at = now()
    RETURNING id, email, role, display_name
  `;
  const { rows } = await pool.query(q, [id, email]);
  return rows[0];
}

export async function getUserById(id: string) {
  const { rows } = await pool.query('SELECT id, email, role, display_name, wallet_address, metadata FROM users WHERE id = $1', [id]);
  return rows[0] as { id: string; email: string; role: string; display_name: string | null; wallet_address: string | null; metadata: any } | undefined;
}

export async function getUserByEmail(email: string) {
  return withRetry(async () => {
    const { rows } = await pool.query('SELECT id, email, role, display_name, wallet_address, metadata FROM users WHERE email = $1', [email]);
    return rows[0] as { id: string; email: string; role: string; display_name: string | null; wallet_address: string | null; metadata: any } | undefined;
  });
}

export async function updateUserDisplayName(userId: string, displayName: string | null) {
  const { rows } = await pool.query(
    'UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1 RETURNING id, email, role, display_name',
    [userId, displayName]
  );
  return rows[0] as { id: string; email: string; role: string; display_name: string | null } | undefined;
}

export async function updateUserProfile(userId: string, params: { display_name?: string | null; wallet_address?: string | null; profile?: Record<string, any> | null }) {
  // Fetch current metadata to merge
  const current = await getUserById(userId);
  const curMeta = (current?.metadata as any) || {};
  const curProfile = (curMeta.profile as any) || {};
  const nextProfile = params.profile === null ? {} : { ...curProfile, ...(params.profile || {}) };
  const nextMeta = { ...curMeta, profile: nextProfile };
  const { rows } = await pool.query(
    'UPDATE users SET display_name = COALESCE($2, display_name), wallet_address = COALESCE($3, wallet_address), metadata = $4, updated_at = now() WHERE id = $1 RETURNING id, email, role, display_name, wallet_address, metadata',
    [userId, typeof params.display_name === 'undefined' ? null : params.display_name, typeof params.wallet_address === 'undefined' ? null : params.wallet_address, JSON.stringify(nextMeta)]
  );
  return rows[0] as { id: string; email: string; role: string; display_name: string | null; wallet_address: string | null; metadata: any } | undefined;
}

export async function countUsers(): Promise<{ total: number; normal: number; pro: number; admin: number }> {
  const { rows } = await pool.query(`SELECT role, COUNT(*)::int AS c FROM users GROUP BY role`);
  let total = 0, normal = 0, pro = 0, admin = 0;
  for (const r of rows as Array<{ role: string; c: number }>) {
    total += r.c;
    if (r.role === 'normal') normal = r.c;
    else if (r.role === 'pro') pro = r.c;
    else if (r.role === 'admin') admin = r.c;
  }
  return { total, normal, pro, admin };
}

export async function listActiveUsers(limit = 200): Promise<Array<{ id: string; email: string; role: string; display_name: string | null; last_seen_at: Date }>> {
  const lim = Math.min(Math.max(limit, 1), 1000);
  const q = `
    SELECT u.id, u.email, u.role, u.display_name,
           MAX(COALESCE(s.last_active_at, s.expires_at)) AS last_seen_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.revoked_at IS NULL AND s.expires_at > now()
    GROUP BY u.id, u.email, u.role, u.display_name
    ORDER BY last_seen_at DESC
    LIMIT ${lim}
  `;
  const { rows } = await pool.query(q);
  return rows as Array<{ id: string; email: string; role: string; display_name: string | null; last_seen_at: Date }>;
}

export async function ensureEntitlements(userId: string) {
  await pool.query(
    `INSERT INTO entitlements (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export async function getEntitlements(userId: string) {
  const { rows } = await pool.query('SELECT pro_enabled, wallet_deployments, history_export, chat_agents, hosted_frontend, limits FROM entitlements WHERE user_id = $1', [userId]);
  return rows[0] ?? { pro_enabled: false, wallet_deployments: false, history_export: false, chat_agents: false, hosted_frontend: false, limits: {} };
}

// --- Sessions ---
export type SessionRow = {
  id: string;
  user_id: string;
  session_hash: string;
  refresh_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
};

export async function createSession(params: {
  userId: string;
  sessionHash: string;
  refreshHash: string | null;
  expiresAt: Date;
  ip?: string | null;
  deviceInfo?: Record<string, any>;
}): Promise<SessionRow> {
  const id = randomUUID();
  const q = `
    INSERT INTO sessions (id, user_id, session_hash, refresh_hash, expires_at, ip, device_info)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, user_id, session_hash, refresh_hash, expires_at, revoked_at
  `;
  const { rows } = await pool.query(q, [
    id,
    params.userId,
    params.sessionHash,
    params.refreshHash,
    params.expiresAt,
    params.ip || null,
    JSON.stringify(params.deviceInfo || {}),
  ]);
  return rows[0];
}

export async function findValidSessionByHash(sessionHash: string): Promise<SessionRow | undefined> {
  return withRetry(async () => {
    const q = `
      SELECT id, user_id, session_hash, refresh_hash, expires_at, revoked_at
      FROM sessions
      WHERE session_hash = $1 AND revoked_at IS NULL AND expires_at > now()
    `;
    const { rows } = await pool.query(q, [sessionHash]);
    return rows[0];
  });
}

export async function revokeSessionByHash(sessionHash: string): Promise<void> {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE session_hash = $1 AND revoked_at IS NULL', [sessionHash]);
}

export async function findSessionByRefreshHash(refreshHash: string): Promise<SessionRow | undefined> {
  return withRetry(async () => {
    const q = `
      SELECT id, user_id, session_hash, refresh_hash, expires_at, revoked_at
      FROM sessions
      WHERE refresh_hash = $1 AND revoked_at IS NULL
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [refreshHash]);
    return rows[0];
  });
}

export async function updateSessionTokens(params: {
  sessionId: string;
  newAccessHash: string;
  newRefreshHash: string | null;
  newExpiresAt: Date;
}): Promise<void> {
  const q = `
    UPDATE sessions
    SET session_hash = $2,
        refresh_hash = $3,
        expires_at = $4,
        last_active_at = now()
    WHERE id = $1 AND revoked_at IS NULL
  `;
  await pool.query(q, [params.sessionId, params.newAccessHash, params.newRefreshHash, params.newExpiresAt]);
}

// --- Audit Logs ---
export async function insertAuditLog(params: { userId?: string | null; event: string; metadata?: Record<string, any> }) {
  const id = randomUUID();
  const meta = JSON.stringify(params.metadata || {});
  await pool.query(
    `INSERT INTO audit_logs (id, user_id, event, metadata)
     VALUES ($1, $2, $3, $4)`,
    [id, params.userId || null, params.event, meta]
  );
}

// --- Jobs ownership and cache ---
export type UserJobRow = {
  job_id: string;
  user_id: string;
  type: string;
  prompt: string | null;
  filename: string | null;
  network: string;
  created_at: Date;
};

export async function attachUserJob(params: {
  jobId: string;
  userId: string;
  type?: string;
  prompt?: string | null;
  filename?: string | null;
  network: string;
}): Promise<UserJobRow> {
  const q = `
    INSERT INTO user_jobs (job_id, user_id, type, prompt, filename, network)
    VALUES ($1, $2, COALESCE($3, 'pipeline'), $4, $5, $6)
    ON CONFLICT (job_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          type = EXCLUDED.type,
          prompt = EXCLUDED.prompt,
          filename = EXCLUDED.filename,
          network = EXCLUDED.network,
          updated_at = now()
    RETURNING job_id, user_id, type, prompt, filename, network, created_at
  `;
  const { rows } = await pool.query(q, [
    params.jobId,
    params.userId,
    params.type ?? null,
    params.prompt ?? null,
    params.filename ?? null,
    params.network,
  ]);
  return rows[0];
}

export type JobWithCache = UserJobRow & {
  state: string | null;
  progress: number | null;
  address: string | null;
  fq_name: string | null;
  constructor_args: any[] | null;
  verified: boolean | null;
  explorer_url: string | null;
  completed_at: Date | null;
  updated_at: Date | null;
};

export async function listUserJobs(userId: string, opts?: { type?: string; limit?: number }): Promise<JobWithCache[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const args: any[] = [userId];
  let where = 'j.user_id = $1 AND j.deleted_at IS NULL';
  if (opts?.type) { args.push(opts.type); where += ` AND j.type = $${args.length}`; }
  // Advanced optional filters if present on opts (kept backward-compatible)
  const anyOpts: any = opts || {};
  if (anyOpts.state) { args.push(anyOpts.state); where += ` AND c.state = $${args.length}`; }
  if (anyOpts.network) { args.push(anyOpts.network); where += ` AND j.network = $${args.length}`; }
  if (anyOpts.q) { const s = `%${String(anyOpts.q)}%`; args.push(s); where += ` AND (j.filename ILIKE $${args.length} OR c.fq_name ILIKE $${args.length})`; }
  // Cursor: expect { created_at, job_id }
  if (anyOpts.cursor && anyOpts.cursor.created_at && anyOpts.cursor.job_id) {
    args.push(anyOpts.cursor.created_at);
    args.push(anyOpts.cursor.job_id);
    where += ` AND (j.created_at < $${args.length - 1} OR (j.created_at = $${args.length - 1} AND j.job_id < $${args.length}))`;
  }
  const q = `
    SELECT j.job_id, j.user_id, j.type, j.prompt, j.filename, j.network, j.created_at,
           c.state, c.progress, c.address, c.fq_name, c.constructor_args, c.verified, c.explorer_url, c.completed_at, c.updated_at
    FROM user_jobs j
    LEFT JOIN job_cache c ON c.job_id = j.job_id
    WHERE ${where}
    ORDER BY j.created_at DESC, j.job_id DESC
    LIMIT ${limit}
  `;
  const { rows } = await pool.query(q, args);
  return rows as JobWithCache[];
}

export async function getUserJobWithCache(userId: string, jobId: string): Promise<JobWithCache | undefined> {
  const q = `
    SELECT j.job_id, j.user_id, j.type, j.prompt, j.filename, j.network, j.created_at,
           c.state, c.progress, c.address, c.fq_name, c.constructor_args, c.verified, c.explorer_url, c.completed_at, c.updated_at
    FROM user_jobs j
    LEFT JOIN job_cache c ON c.job_id = j.job_id
    WHERE j.user_id = $1 AND j.job_id = $2 AND j.deleted_at IS NULL
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [userId, jobId]);
  return rows[0] as JobWithCache | undefined;
}

export async function upsertJobCache(params: {
  jobId: string;
  state: string;
  progress?: number;
  address?: string | null;
  fq_name?: string | null;
  constructor_args?: any[];
  verified?: boolean;
  explorer_url?: string | null;
  completed_at?: Date | null;
}): Promise<void> {
  const q = `
    INSERT INTO job_cache (job_id, state, progress, address, fq_name, constructor_args, verified, explorer_url, completed_at)
    VALUES ($1, $2, COALESCE($3, 0), $4, $5, COALESCE($6, '[]'::jsonb), COALESCE($7, false), $8, $9)
    ON CONFLICT (job_id) DO UPDATE SET
      state = EXCLUDED.state,
      progress = EXCLUDED.progress,
      address = EXCLUDED.address,
      fq_name = EXCLUDED.fq_name,
      constructor_args = EXCLUDED.constructor_args,
      verified = EXCLUDED.verified,
      explorer_url = EXCLUDED.explorer_url,
      completed_at = EXCLUDED.completed_at,
      updated_at = now()
  `;
  await pool.query(q, [
    params.jobId,
    params.state,
    params.progress ?? null,
    params.address ?? null,
    params.fq_name ?? null,
    JSON.stringify(params.constructor_args ?? []),
    params.verified ?? null,
    params.explorer_url ?? null,
    params.completed_at ?? null,
  ]);
}

// --- User Avatars ---
export async function insertUserAvatar(params: { userId: string; contentType: string; bytes: Buffer }): Promise<{ id: string; user_id: string; content_type: string; created_at: Date }>{
  const id = randomUUID();
  const q = `
    INSERT INTO user_avatars (id, user_id, content_type, bytes)
    VALUES ($1, $2, $3, $4)
    RETURNING id, user_id, content_type, created_at
  `;
  const { rows } = await pool.query(q, [id, params.userId, params.contentType, params.bytes]);
  return rows[0] as { id: string; user_id: string; content_type: string; created_at: Date };
}

export async function getUserAvatarById(id: string): Promise<{ id: string; user_id: string; content_type: string; bytes: Buffer; created_at: Date } | undefined> {
  const { rows } = await pool.query(
    'SELECT id, user_id, content_type, bytes, created_at FROM user_avatars WHERE id = $1 LIMIT 1',
    [id]
  );
  return rows[0] as { id: string; user_id: string; content_type: string; bytes: Buffer; created_at: Date } | undefined;
}

export async function deleteUserAvatar(id: string, userId: string): Promise<number> {
  const { rowCount } = await pool.query('DELETE FROM user_avatars WHERE id = $1 AND user_id = $2', [id, userId]);
  return rowCount || 0;
}

export async function pruneUserAvatars(userId: string, keepLatest: number): Promise<number> {
  const q = `
    WITH keep AS (
      SELECT id FROM user_avatars WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
    )
    DELETE FROM user_avatars ua
    WHERE ua.user_id = $1 AND ua.id NOT IN (SELECT id FROM keep)
  `;
  const { rowCount } = await pool.query(q, [userId, keepLatest]);
  return rowCount || 0;
}

export async function listUserAvatars(userId: string, limit = 10): Promise<Array<{ id: string; content_type: string; created_at: Date; size: number }>> {
  const { rows } = await pool.query(
    'SELECT id, content_type, created_at, octet_length(bytes) as size FROM user_avatars WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows.map(r => ({ id: r.id, content_type: r.content_type, created_at: r.created_at, size: Number(r.size) || 0 }));
}
