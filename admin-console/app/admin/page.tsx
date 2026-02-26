'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '../../lib/api'
import { Users, Key, Activity, Search } from 'lucide-react'

export default function AdminHome() {
  const [me, setMe] = useState<any>(null)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch('/u/user/me')
        const j = await r.json()
        setMe(j)
      } catch (e:any) {
        setErr(e.message)
      }
    })()
  }, [])

  const cards = [
    {
      href: '/admin/users/lookup',
      icon: Search,
      title: 'User Lookup',
      description: 'Search users by email or ID',
      color: 'bg-blue-50 text-blue-600',
    },
    {
      href: '/admin/users/active',
      icon: Activity,
      title: 'Active Users',
      description: 'View recently active sessions',
      color: 'bg-green-50 text-green-600',
    },
    {
      href: '/admin/keys',
      icon: Key,
      title: 'Premium Keys',
      description: 'Mint, list and revoke keys',
      color: 'bg-purple-50 text-purple-600',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-slate-600 mt-1">Manage users and premium access</p>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">{err}</div>
      )}

      {/* User Info Card */}
      {me && (
        <div className="card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <Users className="w-6 h-6 text-slate-600" />
            </div>
            <div>
              <div className="text-sm text-slate-500">Signed in as</div>
              <div className="font-medium text-slate-900">{me?.user?.email}</div>
              <div className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                {me?.user?.role}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="card group hover:shadow-md hover:border-slate-300 transition-all"
            >
              <div className={`w-10 h-10 rounded-lg ${card.color} flex items-center justify-center mb-3`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div className="font-medium text-slate-900 group-hover:text-black">{card.title}</div>
              <div className="text-sm text-slate-500 mt-0.5">{card.description}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
