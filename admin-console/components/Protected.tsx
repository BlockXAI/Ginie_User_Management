'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../lib/api'

export default function Protected({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/u/user/me');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (j?.user?.role !== 'admin') {
          setErr('Not authorized. Admin role required.');
          setOk(false);
          return;
        }
        if (!cancelled) setOk(true);
      } catch (e:any) {
        setErr(e.message);
        setOk(false);
        router.push('/');
      }
    })();
    return () => { cancelled = true };
  }, [router]);

  if (ok === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Checking permissions…
      </div>
    );
  }

  if (!ok) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-red-600">{err}</div>
        <button onClick={() => router.push('/')} className="text-sm text-blue-600 hover:underline">
          ← Back to login
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
