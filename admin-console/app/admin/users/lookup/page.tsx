'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'
import { Search, User, Shield, Wallet, Calendar, Clock, Mail, Hash, Building, MapPin, Globe, Github, Linkedin, Twitter } from 'lucide-react'

export default function UsersLookupPage() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [id, setId] = useState('')
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [jobs, setJobs] = useState<any[] | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsErr, setJobsErr] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [selectedUpstream, setSelectedUpstream] = useState<any>(null)
  const [selectedArtifacts, setSelectedArtifacts] = useState<any>(null)
  const [selectedLoading, setSelectedLoading] = useState(false)

  const [proEnabled, setProEnabled] = useState<boolean | null>(null)
  const [walletDeployments, setWalletDeployments] = useState<boolean | null>(null)

  function toErr(status: number, j: any): string {
    const code = j?.error?.code || j?.code
    if (status === 401 || code === 'unauthorized') return 'You are not signed in (or your session expired). Please sign in again.'
    if (status === 403 || code === 'forbidden') return 'You do not have permission for this action.'
    if (status === 429 || code === 'rate_limited') return 'Too many requests. Please wait a moment and try again.'
    if (status === 404 || code === 'not_found') return 'No matching record found. Double-check the email or user id.'
    if (status === 400 || code === 'bad_request') return 'Please check your input and try again.'
    return typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || `HTTP ${status}`
  }

  async function loadJobs(userId: string) {
    setJobsErr('')
    setJobsLoading(true)
    try {
      const r = await apiFetch(`/u/admin/users/${encodeURIComponent(userId)}/jobs?limit=50`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setJobs(null)
        setJobsErr(toErr(r.status, j))
        return
      }
      setJobs(Array.isArray(j?.jobs) ? j.jobs : [])
    } catch (e: any) {
      setJobs(null)
      setJobsErr('Could not reach the server. Please try again.')
    } finally {
      setJobsLoading(false)
    }
  }

  async function selectJob(jobId: string) {
    setSelectedJobId(jobId)
    setSelectedUpstream(null)
    setSelectedArtifacts(null)
    setSelectedLoading(true)
    setJobsErr('')
    try {
      const [rUp, rArt] = await Promise.all([
        apiFetch(`/u/admin/jobs/${encodeURIComponent(jobId)}/upstream?includeMagical=true`),
        apiFetch(`/u/admin/jobs/${encodeURIComponent(jobId)}/artifacts`),
      ])
      const jUp = await rUp.json().catch(() => ({}))
      const jArt = await rArt.json().catch(() => ({}))
      if (!rUp.ok) setJobsErr(toErr(rUp.status, jUp))
      if (!rArt.ok) setJobsErr(toErr(rArt.status, jArt))
      if (rUp.ok) setSelectedUpstream(jUp)
      if (rArt.ok) setSelectedArtifacts(jArt)
    } catch (e: any) {
      setJobsErr('Could not reach the server. Please try again.')
    } finally {
      setSelectedLoading(false)
    }
  }

  // Auto-load user from URL params
  useEffect(() => {
    const emailParam = searchParams.get('email')
    const idParam = searchParams.get('id')
    if (emailParam) {
      setEmail(emailParam)
      setTimeout(() => lookupByEmail(emailParam), 100)
    } else if (idParam) {
      setId(idParam)
      setTimeout(() => lookupById(idParam), 100)
    }
  }, [searchParams])

  async function lookupByEmail(emailVal: string) {
    setErr(''); setRes(null); setLoading(true)
    try {
      const r = await apiFetch(`/u/admin/user/lookup?email=${encodeURIComponent(emailVal)}`)
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(toErr(r.status, j)); return }
      setRes(j)
      setProEnabled(Boolean(j?.entitlements?.pro_enabled))
      setWalletDeployments(Boolean(j?.entitlements?.wallet_deployments))
      setSelectedJobId(''); setSelectedUpstream(null); setSelectedArtifacts(null)
      if (j?.user?.id) await loadJobs(String(j.user.id))
    } catch (e: any) {
      setErr('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function lookupById(idVal: string) {
    setErr(''); setRes(null); setLoading(true)
    try {
      const r = await apiFetch(`/u/admin/user/lookup?id=${encodeURIComponent(idVal)}`)
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(toErr(r.status, j)); return }
      setRes(j)
      setProEnabled(Boolean(j?.entitlements?.pro_enabled))
      setWalletDeployments(Boolean(j?.entitlements?.wallet_deployments))
      setSelectedJobId(''); setSelectedUpstream(null); setSelectedArtifacts(null)
      if (j?.user?.id) await loadJobs(String(j.user.id))
    } catch (e: any) {
      setErr('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function lookup() {
    setErr(''); setRes(null); setLoading(true)
    try {
      const qs = email ? `email=${encodeURIComponent(email)}` : id ? `id=${encodeURIComponent(id)}` : ''
      if (!qs) { setErr('Provide email or id'); return }
      const r = await apiFetch(`/u/admin/user/lookup?${qs}`)
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(toErr(r.status, j)); return }
      setRes(j)
      setProEnabled(Boolean(j?.entitlements?.pro_enabled))
      setWalletDeployments(Boolean(j?.entitlements?.wallet_deployments))
      setSelectedJobId(''); setSelectedUpstream(null); setSelectedArtifacts(null)
      if (j?.user?.id) await loadJobs(String(j.user.id))
    } catch (e: any) {
      setErr('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function saveEntitlements() {
    if (!res?.user?.email) { setErr('No user loaded'); return }
    setSaving(true); setErr('')
    try {
      const body: any = { email: res.user.email }
      if (proEnabled !== null) body.pro_enabled = proEnabled
      if (walletDeployments !== null) body.wallet_deployments = walletDeployments
      const r = await apiFetch('/u/admin/users/entitlements', { method: 'POST', body: JSON.stringify(body) })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(toErr(r.status, j)); return }
      await lookup()
    } catch (e: any) {
      setErr('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function downgrade() {
    if (!res?.user?.email) { setErr('No user loaded'); return }
    setSaving(true); setErr('')
    try {
      const r = await apiFetch('/u/admin/users/downgrade', { method: 'POST', body: JSON.stringify({ email: res.user.email }) })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setErr(toErr(r.status, j)); return }
      await lookup()
    } catch (e: any) {
      setErr('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">User Lookup</h1>
        <p className="text-slate-600 mt-1">Search and manage user accounts</p>
      </div>

      {/* Search Form */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-slate-400" />
          <span className="font-medium">Search User</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              className="input"
              placeholder="user@example.com"
              value={email}
              onChange={e=>setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookup()}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">User ID</label>
            <input
              className="input"
              placeholder="usr_..."
              value={id}
              onChange={e=>setId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookup()}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn" onClick={lookup} disabled={loading || (!email && !id)}>
            {loading ? 'Searching…' : 'Search'}
          </button>
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
      </div>

      {/* Results */}
      {res && (
        <div className="space-y-4">
          {/* User Details - Full Width */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-5 h-5 text-slate-400" />
              <span className="font-medium">User Details</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                  <Hash className="w-3 h-3" /> ID
                </dt>
                <dd className="font-mono text-sm mt-1 break-all">{res.user?.id || '—'}</dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Email
                </dt>
                <dd className="mt-1">{res.user?.email || '—'}</dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase">Role</dt>
                <dd className="mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    res.user?.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {res.user?.role || 'normal'}
                  </span>
                </dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase">Display Name</dt>
                <dd className="mt-1">{res.user?.display_name || <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Wallet Address
                </dt>
                <dd className="font-mono text-xs mt-1 break-all">{res.user?.wallet_address || <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Created At
                </dt>
                <dd className="mt-1 text-sm">{res.user?.created_at ? new Date(res.user.created_at).toLocaleString() : <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Last Seen
                </dt>
                <dd className="mt-1 text-sm">{res.user?.last_seen_at ? new Date(res.user.last_seen_at).toLocaleString() : <span className="text-slate-400">—</span>}</dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Updated At
                </dt>
                <dd className="mt-1 text-sm">{res.user?.updated_at ? new Date(res.user.updated_at).toLocaleString() : <span className="text-slate-400">—</span>}</dd>
              </div>
            </div>
          </div>

          {/* Profile Details */}
          {res.user?.profile && Object.keys(res.user.profile).length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Building className="w-5 h-5 text-slate-400" />
                <span className="font-medium">Profile</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {res.user.profile.organization && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                      <Building className="w-3 h-3" /> Organization
                    </dt>
                    <dd className="mt-1">{res.user.profile.organization}</dd>
                  </div>
                )}
                {res.user.profile.role && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <dt className="text-xs font-medium text-slate-500 uppercase">Job Role</dt>
                    <dd className="mt-1">{res.user.profile.role}</dd>
                  </div>
                )}
                {(res.user.profile.location || res.user.profile.city || res.user.profile.country) && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <dt className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Location
                    </dt>
                    <dd className="mt-1">{[res.user.profile.city, res.user.profile.state, res.user.profile.country].filter(Boolean).join(', ') || res.user.profile.location || '—'}</dd>
                  </div>
                )}
                {res.user.profile.bio && (
                  <div className="p-3 bg-slate-50 rounded-lg md:col-span-2 lg:col-span-3">
                    <dt className="text-xs font-medium text-slate-500 uppercase">Bio</dt>
                    <dd className="mt-1 text-sm">{res.user.profile.bio}</dd>
                  </div>
                )}
                {res.user.profile.phone && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <dt className="text-xs font-medium text-slate-500 uppercase">Phone</dt>
                    <dd className="mt-1">{res.user.profile.phone}</dd>
                  </div>
                )}
                {res.user.profile.birthday && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <dt className="text-xs font-medium text-slate-500 uppercase">Birthday</dt>
                    <dd className="mt-1">{res.user.profile.birthday}</dd>
                  </div>
                )}
                {res.user.profile.gender && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <dt className="text-xs font-medium text-slate-500 uppercase">Gender</dt>
                    <dd className="mt-1">{res.user.profile.gender}</dd>
                  </div>
                )}
              </div>
              {/* Social Links */}
              {res.user.profile.social && Object.keys(res.user.profile.social).some(k => res.user.profile.social[k]) && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <dt className="text-xs font-medium text-slate-500 uppercase mb-2">Social Links</dt>
                  <div className="flex flex-wrap gap-3">
                    {res.user.profile.social.github && (
                      <a href={res.user.profile.social.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 rounded-full text-sm hover:bg-slate-200">
                        <Github className="w-4 h-4" /> GitHub
                      </a>
                    )}
                    {res.user.profile.social.linkedin && (
                      <a href={res.user.profile.social.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm hover:bg-blue-200">
                        <Linkedin className="w-4 h-4" /> LinkedIn
                      </a>
                    )}
                    {res.user.profile.social.twitter && (
                      <a href={res.user.profile.social.twitter} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-sky-100 text-sky-700 rounded-full text-sm hover:bg-sky-200">
                        <Twitter className="w-4 h-4" /> Twitter
                      </a>
                    )}
                    {res.user.profile.social.telegram && (
                      <a href={res.user.profile.social.telegram} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-100 text-cyan-700 rounded-full text-sm hover:bg-cyan-200">
                        <Globe className="w-4 h-4" /> Telegram
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Entitlements */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-slate-400" />
                <span className="font-medium">Entitlements</span>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300"
                    checked={!!proEnabled}
                    onChange={e=>setProEnabled(e.target.checked)}
                  />
                  <div>
                    <div className="font-medium text-sm">Pro Enabled</div>
                    <div className="text-xs text-slate-500">Access to premium features</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300"
                    checked={!!walletDeployments}
                    onChange={e=>setWalletDeployments(e.target.checked)}
                  />
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-slate-400" />
                    <div>
                      <div className="font-medium text-sm">Wallet Deployments</div>
                      <div className="text-xs text-slate-500">Can deploy with wallet</div>
                    </div>
                  </div>
                </label>
                {/* Show all entitlements from API */}
                {res.entitlements && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <div className="text-xs font-medium text-slate-500 uppercase mb-2">All Entitlements</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(res.entitlements).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                          <span className="text-slate-600">{key.replace(/_/g, ' ')}</span>
                          <span className={value ? 'text-green-600 font-medium' : 'text-slate-400'}>{value ? '✓' : '✗'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <button className="btn" onClick={saveEntitlements} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={downgrade}
                    disabled={saving}
                  >
                    Downgrade to Normal
                  </button>
                </div>
              </div>
            </div>

            {/* Job Stats */}
            {res.counts && (
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-5 h-5 text-slate-400" />
                  <span className="font-medium">Activity Stats</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-lg text-center">
                    <div className="text-3xl font-bold text-slate-900">{res.counts.jobs_today ?? 0}</div>
                    <div className="text-sm text-slate-500 mt-1">Jobs Today</div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg text-center">
                    <div className="text-3xl font-bold text-slate-900">{res.counts.jobs_total ?? 0}</div>
                    <div className="text-sm text-slate-500 mt-1">Total Jobs</div>
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-slate-400" />
                  <span className="font-medium">Jobs</span>
                </div>
                <button
                  className="px-3 py-1.5 text-xs rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => res?.user?.id && loadJobs(String(res.user.id))}
                  disabled={!res?.user?.id || jobsLoading}
                >
                  {jobsLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {jobsErr && <div className="text-sm text-red-600 mb-3">{jobsErr}</div>}

              {!jobsLoading && (!jobs || jobs.length === 0) && (
                <div className="text-sm text-slate-500">No jobs found for this user.</div>
              )}

              {jobs && jobs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        <th className="py-2 pr-2">Job</th>
                        <th className="py-2 pr-2">State</th>
                        <th className="py-2 pr-2">Network</th>
                        <th className="py-2 pr-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j: any) => (
                        <tr
                          key={j.job_id}
                          className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${selectedJobId === j.job_id ? 'bg-slate-50' : ''}`}
                          onClick={() => selectJob(String(j.job_id))}
                        >
                          <td className="py-2 pr-2 font-mono text-xs break-all">{String(j.job_id).slice(0, 36)}{String(j.job_id).length > 36 ? '…' : ''}</td>
                          <td className="py-2 pr-2">{j.state || '—'}</td>
                          <td className="py-2 pr-2">{j.network || '—'}</td>
                          <td className="py-2 pr-2">{j.created_at ? new Date(j.created_at).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedJobId && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="text-sm font-medium text-slate-900 mb-2">Selected Job</div>
                  <div className="text-xs text-slate-600 font-mono break-all">{selectedJobId}</div>
                  {selectedLoading && <div className="text-sm text-slate-500 mt-2">Loading analysis…</div>}

                  {selectedUpstream && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">Upstream Detail</summary>
                      <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-xs">{JSON.stringify(selectedUpstream, null, 2)}</pre>
                    </details>
                  )}

                  {selectedArtifacts && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">Artifacts</summary>
                      <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-xs">{JSON.stringify(selectedArtifacts, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Raw Data (collapsible) */}
          <details className="card">
            <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-900">Raw API Response</summary>
            <pre className="mt-4 p-4 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-xs">{JSON.stringify(res, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  )
}
