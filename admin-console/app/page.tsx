'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../lib/api'

export default function Page() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [step, setStep] = useState<'send'|'verify'>('send');
  const [msg, setMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function toErr(x: any, status?: number): string {
    if (!x) {
      if (status === 0) return 'Could not reach the server. Please check your connection and try again.';
      return 'Request failed. Please try again.';
    }
    if (typeof x === 'string') return x;
    const code = x?.error?.code || x?.code;
    if (code === 'bad_request') {
      if (step === 'send') return 'Please enter a valid email and name, then try again.';
      return 'Please enter the 6-digit code from your email and try again.';
    }
    if (code === 'rate_limited') return 'Too many attempts. Please wait a moment and try again.';
    if (code === 'unauthorized') return 'Session expired. Please sign in again.';
    if (code === 'user_not_found') return 'No account found for this email. Contact support if you need admin access.';
    if (typeof x.error === 'string') return x.error;
    if (x.error && typeof x.error.message === 'string') return x.error.message;
    if (typeof x.message === 'string') return x.message;
    if (typeof code === 'string') return code;
    try { return JSON.stringify(x); } catch { return 'Request failed. Please try again.'; }
  }

  async function sendOtp() {
    setMsg(''); setLoading(true);
    try {
      const res = await apiFetch('/u/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ identity: email, name })
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        if (j?.challengeId) setChallengeId(j.challengeId);
        setStep('verify');
      } else {
        setMsg(toErr(j, res.status) || 'Failed to send OTP');
      }
    } catch (e: any) {
      setMsg('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setMsg(''); setLoading(true);
    try {
      const res = await apiFetch('/u/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ identity: email, otp, challengeId })
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/admin');
      } else {
        setMsg(toErr(j, res.status) || 'OTP verify failed');
      }
    } catch (e: any) {
      setMsg('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-black text-white text-2xl font-bold mb-4">
            EVI
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin Console</h1>
          <p className="text-slate-600 mt-1">Sign in to manage users and keys</p>
        </div>

        {/* Login Form */}
        {step === 'send' && (
          <div className="card space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                className="input"
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={e=>setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && email && name && sendOtp()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
              <input
                className="input"
                type="text"
                required
                placeholder="Your name"
                value={name}
                onChange={e=>setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && email && name && sendOtp()}
              />
            </div>
            <button
              className="btn w-full"
              onClick={sendOtp}
              disabled={!email || !name || loading}
            >
              {loading ? 'Sending…' : 'Send One-Time Code'}
            </button>
            {msg && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{msg}</p>}
          </div>
        )}

        {step === 'verify' && (
          <div className="card space-y-4">
            <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-md">
              {challengeId ? (
                <>📧 Code sent to <strong>{email}</strong></>
              ) : (
                'Enter the code from your email'
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Verification Code</label>
              <input
                className="input text-center text-lg tracking-widest font-mono"
                type="text"
                required
                placeholder="123456"
                value={otp}
                onChange={e=>setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && otp && verifyOtp()}
                maxLength={6}
                autoFocus
              />
            </div>
            <button
              className="btn w-full"
              onClick={verifyOtp}
              disabled={!otp || loading}
            >
              {loading ? 'Verifying…' : 'Verify & Sign In'}
            </button>
            <button
              onClick={() => { setStep('send'); setOtp(''); setMsg(''); }}
              className="w-full text-sm text-slate-600 hover:text-slate-900"
            >
              ← Use different email
            </button>
            {msg && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{msg}</p>}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-slate-500">
          Admin access required. Contact support if you need access.
        </div>
      </div>
    </div>
  )
}
