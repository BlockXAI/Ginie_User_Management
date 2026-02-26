import crypto from 'crypto';
import { env } from './env.js';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function tokenHash(token: string): string {
  const hmac = crypto.createHmac('sha256', env.SESSION_SECRET);
  hmac.update(token);
  return hmac.digest('hex');
}

export function getClientIp(xff: string | string[] | undefined, reqIp: string | undefined): string | null {
  if (Array.isArray(xff)) return xff[0] || null;
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  if (typeof reqIp === 'string') return reqIp;
  return null;
}
