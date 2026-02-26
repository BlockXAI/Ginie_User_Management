'use client'

// Production API fetch helper with credentials, CSRF header on writes, and auto-refresh on 401
//
// All requests go through the Next.js API proxy at /api/proxy to keep cookies same-origin.
// This avoids cross-site cookie issues that occur when calling the backend directly.

const BASE = '/api/proxy';

function getCsrf() {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|; )evium_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function apiFetch(path: string, init?: RequestInit & { retry?: boolean }): Promise<Response> {
  const url = (() => {
    if (path.startsWith('http')) return path;
    const normalized = `/${String(path).trim().replace(/^\/+/g, '')}`;
    if (normalized.startsWith(`${BASE}/`)) return normalized;
    if (normalized === BASE) return normalized;
    return `${BASE}${normalized}`;
  })();
  const method = (init?.method || 'GET').toUpperCase();
  const headers: HeadersInit = {
    ...(init?.headers || {}),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    (headers as Record<string, string>)['x-csrf-token'] = getCsrf();
    if (!(headers as Record<string, string>)['Content-Type']) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (res.status === 401 && !init?.retry) {
    // attempt refresh once
    await fetch(`${BASE}/u/auth/refresh`, { method: 'POST', credentials: 'include' });
    return apiFetch(path, { ...init, retry: true });
  }
  return res;
}

export { BASE as API_BASE };
