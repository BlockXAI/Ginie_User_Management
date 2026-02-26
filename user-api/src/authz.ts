import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { findValidSessionByHash, getUserById, getEntitlements } from './db.js';
import { tokenHash } from './utils.js';
import { env } from './env.js';

const roleRank: Record<string, number> = { normal: 0, pro: 1, admin: 2 };

/**
 * Timing-safe string comparison to prevent timing attacks on secret tokens.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Service-to-service auth middleware.
 * Validates `Authorization: Bearer <USERAPI_SERVICE_SECRET>` header using timing-safe comparison.
 * Reads `X-User-Id` header to set req.auth.userId for downstream ownership.
 * Validates that userId is a non-empty trimmed string (max 128 chars, no control characters).
 */
export async function requireServiceAuth(req: Request, res: Response, next: NextFunction) {
  const secret = env.USERAPI_SERVICE_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ level: 'error', msg: 'service_auth.not_configured', path: req.path }));
    return res.status(503).json({ ok: false, error: { code: 'service_auth_not_configured' } });
  }
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || !safeCompare(token, secret)) {
    console.log(JSON.stringify({ level: 'warn', msg: 'service_auth.rejected', path: req.path, hasToken: !!token }));
    return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'invalid service token' } });
  }
  const userId = (req.get('x-user-id') || '').trim();
  if (!userId) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'X-User-Id header required' } });
  }
  if (userId.length > 128 || /[\x00-\x1f]/.test(userId)) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'X-User-Id header contains invalid characters or is too long' } });
  }
  (req as any).auth = { userId, isService: true };
  return next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const access = (req as any).cookies?.evium_access || (req as any).cookies?.['evium_access'];
  if (!access) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  const sess = await findValidSessionByHash(tokenHash(String(access)));
  if (!sess) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
  (req as any).auth = { userId: sess.user_id };
  return next();
}

export function requireRole(minRole: 'normal' | 'pro' | 'admin') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).auth?.userId as string | undefined;
    if (!userId) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const has = (roleRank[user.role] ?? 0) >= (roleRank[minRole] ?? 0);
    if (!has) return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
    (req as any).user = user;
    return next();
  };
}

export function requireEntitlement(flag: 'pro_enabled' | 'wallet_deployments' | 'history_export' | 'chat_agents' | 'hosted_frontend') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).auth?.userId as string | undefined;
    if (!userId) return res.status(401).json({ ok: false, error: { code: 'unauthorized' } });
    const ent = await getEntitlements(userId);
    if (ent && ent[flag]) {
      (req as any).entitlements = ent;
      return next();
    }
    if (flag === 'wallet_deployments') {
      if (ent?.pro_enabled) {
        (req as any).entitlements = ent;
        return next();
      }
      const user = await getUserById(userId);
      if (user && (user.role === 'pro' || user.role === 'admin')) {
        (req as any).user = user;
        (req as any).entitlements = ent;
        return next();
      }
    }
    return res.status(403).json({ ok: false, error: { code: 'forbidden' } });
  };
}
