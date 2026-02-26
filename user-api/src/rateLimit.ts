import { redis } from './redis.js';

export async function allow(key: string, limit: number, ttlSeconds: number): Promise<{ ok: boolean; remaining: number }>{
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttlSeconds);
  }
  const remaining = Math.max(0, limit - count);
  return { ok: count <= limit, remaining };
}
