'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { authCallbackUrl, safeNextPath } from '@/lib/site-url'
import AuthCard from '@/components/AuthCard'
import { useLocationSearch } from '@/lib/hooks/useLocation'

// Email + password sign-in. Accounts are created by admins (Settings > Team
// sends an invite email); there is no self-signup. "Forgot password?" emails a
// reset link that lands on /auth/set-password via /auth/callback.

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'That sign-in link is invalid or has expired. Try again or reset your password.',
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'password' | 'reset'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // null until the user acts: until then, show any error from the URL
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  // Read the query on the client (avoids a Suspense boundary for useSearchParams)
  const params = new URLSearchParams(useLocationSearch() ?? '')
  const next = safeNextPath(params.get('next'))
  const code = params.get('error')
  // Only known codes: never echo arbitrary text from the URL
  const error = actionError ?? (code ? (ERROR_MESSAGES[code] ?? 'Sign-in failed. Please try again.') : '')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError('')
    setNotice('')
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setActionError(error.message)
      setLoading(false)
      return
    }

    router.replace(next)
    router.refresh()
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError('')
    setNotice('')
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authCallbackUrl(window.location.origin, '/auth/set-password'),
    })
    setLoading(false)

    if (error) {
      setActionError(error.message)
      return
    }
    // Same message whether or not the email is on the team
    setNotice('If that address belongs to a team member, a reset link is on its way.')
  }

  const switchMode = (to: 'password' | 'reset') => {
    setMode(to)
    setActionError('')
    setNotice('')
  }

  return (
    <AuthCard
      title={mode === 'password' ? 'Welcome back' : 'Reset your password'}
      subtitle={
        mode === 'password'
          ? 'Sign in with your team email'
          : 'We’ll email you a link to choose a new password'
      }
    >
      <form onSubmit={mode === 'password' ? handleLogin : handleReset} className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            placeholder="you@example.org"
          />
        </div>

        {mode === 'password' && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="text-xs text-gray-500 hover:text-gray-900"
              >
                Forgot password?
              </button>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100">
            {error}
          </div>
        )}
        {notice && (
          <div className="bg-green-50 text-green-800 text-sm p-3 rounded-lg border border-green-100">
            {notice}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn btn-primary w-full py-3">
          {mode === 'password'
            ? loading
              ? 'Signing in…'
              : 'Sign in'
            : loading
              ? 'Sending…'
              : 'Send reset link'}
        </button>

        {mode === 'reset' && (
          <p className="text-center text-sm">
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="text-gray-500 hover:text-gray-900"
            >
              Back to sign in
            </button>
          </p>
        )}
      </form>
    </AuthCard>
  )
}
