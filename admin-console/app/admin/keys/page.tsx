'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import CopyButton from '../../../components/CopyButton'
import { Key, Plus, RefreshCw, XCircle } from 'lucide-react'

interface KeyRow { id: string; status: string; expires_at?: string; redeemed_by_email?: string; created_at?: string }

export default function KeysPage() {
  const [status, setStatus] = useState<string>('')
  const [limit, setLimit] = useState<number>(50)
  const [rows, setRows] = useState<KeyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [minting, setMinting] = useState(false)
  const [err, setErr] = useState<string>('')

  const [expiresAt, setExpiresAt] = useState<string>('')
  const [mintedKey, setMintedKey] = useState<{ id: string; key: string } | null>(null)

  async function load() {
    setLoading(true); setErr('')
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (limit) qs.set('limit', String(limit))
      const r = await apiFetch(`/u/admin/keys${qs.toString() ? `?${qs.toString()}` : ''}`)
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || `HTTP ${r.status}`); setRows([]) }
      else setRows(Array.isArray(j?.keys) ? j.keys : (Array.isArray(j) ? j : []))
    } catch (e:any) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function mint() {
    setErr(''); setMintedKey(null); setMinting(true)
    try {
      const body: any = {}
      // Convert datetime-local value to ISO string for the API
      if (expiresAt) {
        const date = new Date(expiresAt)
        if (!isNaN(date.getTime())) {
          body.expiresAt = date.toISOString()
        }
      }
      const r = await apiFetch('/u/admin/keys/mint', { method: 'POST', body: JSON.stringify(body) })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || `HTTP ${r.status}`); return }
      if (j?.key && j?.id) setMintedKey({ id: j.id, key: j.key })
      setExpiresAt('')
      await load()
    } finally {
      setMinting(false)
    }
  }

  async function revoke(id: string) {
    setErr('')
    const r = await apiFetch('/u/admin/keys/revoke', { method: 'POST', body: JSON.stringify({ id }) })
    const j = await r.json().catch(()=>({}))
    if (!r.ok) { setErr(typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || `HTTP ${r.status}`); return }
    await load()
  }

  useEffect(() => { load() }, [])

  const statusColors: Record<string, string> = {
    minted: 'bg-green-100 text-green-700',
    redeemed: 'bg-blue-100 text-blue-700',
    revoked: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Premium Keys</h1>
        <p className="text-slate-600 mt-1">Create and manage premium access keys</p>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">{err}</div>
      )}

      {/* Mint Section */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="w-5 h-5 text-slate-400" />
          <span className="font-medium">Mint New Key</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Expiration Date (optional)</label>
            <input
              className="input"
              type="datetime-local"
              value={expiresAt}
              onChange={e=>setExpiresAt(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button className="btn flex items-center gap-2" onClick={mint} disabled={minting}>
              <Key className="w-4 h-4" />
              {minting ? 'Minting…' : 'Mint Key'}
            </button>
          </div>
        </div>

        {mintedKey && (
          <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-amber-800 font-medium mb-2">
              <Key className="w-5 h-5" />
              Key Created — Copy Now (shown once)
            </div>
            <div className="bg-white rounded-md p-3 font-mono text-sm break-all border border-amber-200">
              {mintedKey.key}
            </div>
            <div className="mt-3">
              <CopyButton className="btn" text={mintedKey.key} />
            </div>
          </div>
        )}
      </div>

      {/* Keys List */}
      <div className="card p-0 overflow-hidden">
        {/* Filters */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Status</label>
            <select className="input w-36" value={status} onChange={e=>setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="minted">Minted</option>
              <option value="redeemed">Redeemed</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Limit</label>
            <input className="input w-20 text-center" type="number" value={limit} onChange={e=>setLimit(parseInt(e.target.value||'0')||0)} />
          </div>
          <button className="btn flex items-center gap-2" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-medium text-slate-600">ID</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Status</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Expires</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Redeemed By</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Created</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(k => (
                <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-xs text-slate-500">{k.id}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[k.status] || 'bg-slate-100 text-slate-700'}`}>
                      {k.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">{k.expires_at ? new Date(k.expires_at).toLocaleString() : <span className="text-slate-400">—</span>}</td>
                  <td className="py-3 px-4">
                    {k.redeemed_by_email ? (
                      <a href={`/admin/users/lookup?email=${encodeURIComponent(k.redeemed_by_email)}`} className="text-blue-600 hover:underline">
                        {k.redeemed_by_email}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">{k.created_at ? new Date(k.created_at).toLocaleString() : <span className="text-slate-400">—</span>}</td>
                  <td className="py-3 px-4">
                    {k.status === 'minted' && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-200 text-red-600 hover:bg-red-50"
                        onClick={()=>revoke(k.id)}
                      >
                        <XCircle className="w-3 h-3" />
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="py-8 text-center text-slate-500" colSpan={6}>
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading…
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Key className="w-8 h-8 text-slate-300" />
                        <span>No keys found</span>
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
            Showing {rows.length} key{rows.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
