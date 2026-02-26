'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '../../../../lib/api'
import { Activity, RefreshCw } from 'lucide-react'

interface ActiveUser { id: string; email: string; role: string; display_name?: string | null; last_seen_at?: string | null }

export default function ActiveUsersPage() {
  const [limit, setLimit] = useState(100)
  const [rows, setRows] = useState<ActiveUser[]>([])
  const [err, setErr] = useState<string>('')
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true); setErr('')
    try {
      const r = await apiFetch(`/u/admin/users/active?limit=${limit}`)
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || `HTTP ${r.status}`); setRows([]); }
      else setRows(Array.isArray(j?.users) ? j.users : [])
    } catch(e:any) { setErr(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Active Users</h1>
          <p className="text-slate-600 mt-1">Users with recent activity</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Show</label>
            <input
              className="input w-20 text-center"
              type="number"
              value={limit}
              onChange={e=>setLimit(parseInt(e.target.value||'0')||0)}
            />
          </div>
          <button
            className="btn flex items-center gap-2"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">{err}</div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left py-3 px-4 font-medium text-slate-600">Email</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Role</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Display Name</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Last Seen</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <a href={`/admin/users/lookup?email=${encodeURIComponent(u.email)}`} className="text-blue-600 hover:underline">
                      {u.email}
                    </a>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">{u.display_name || <span className="text-slate-400">—</span>}</td>
                  <td className="py-3 px-4">
                    {u.last_seen_at ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        {new Date(u.last_seen_at).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500">{u.id}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="py-8 text-center text-slate-500" colSpan={5}>
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading…
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Activity className="w-8 h-8 text-slate-300" />
                        <span>No active users found</span>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-sm text-slate-600">
            Showing {rows.length} user{rows.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
