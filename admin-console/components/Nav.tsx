'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch } from '../lib/api'

export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await apiFetch('/u/auth/logout', { method: 'POST' });
    router.push('/');
  }

  const links = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/users/lookup', label: 'User Lookup' },
    { href: '/admin/users/active', label: 'Active Users' },
    { href: '/admin/keys', label: 'Premium Keys' },
  ];

  return (
    <nav className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
      <div className="flex items-center gap-1">
        <Link
          href="/admin"
          className="flex items-center gap-2 font-semibold text-slate-900 mr-4"
        >
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black text-white text-xs font-bold">
            EVI
          </span>
          Admin
        </Link>
        <div className="hidden sm:flex items-center gap-1">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                pathname === link.href
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <button
        onClick={logout}
        className="text-sm px-3 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        Sign out
      </button>
    </nav>
  )
}
