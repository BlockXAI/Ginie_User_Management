import Redis from 'ioredis';
import { env } from './env.js';

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL) : new Redis();

// Prevent ioredis "Unhandled error event" from crashing or destabilizing the process.
// We log a compact error and allow the client to reconnect per ioredis defaults.
redis.on('error', (err: any) => {
  try {
    console.error(JSON.stringify({ level: 'error', msg: 'redis.error', error: err?.message || String(err) }));
  } catch {
    // ignore
  }
});

export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
