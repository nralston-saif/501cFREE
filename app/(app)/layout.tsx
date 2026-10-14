import { redirect } from 'next/navigation'
import { getAuthState } from '@/lib/auth'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { isScriptedAi } from '@/lib/ai/demo'
import NavShell from '@/components/NavShell'

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Cached per request — pages and actions share this same lookup.
  // Defense in depth: RLS already blocks anyone who isn't an active team
  // member, but show a clear message instead of empty pages.
  const { userId, memberId, isAdmin, memberName } = await getAuthState()

  if (!userId) {
    redirect('/login')
  }

  if (!memberId) {
    redirect('/access-denied')
  }

  return (
    <NavShell isAdmin={isAdmin} userName={memberName}>
      {isDemoMode() && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span className="font-semibold">Public demo sandbox.</span> Fictional sample data that
          anyone can view and change. It resets every few hours, so nothing you enter is kept.
          Don&rsquo;t enter real personal data.{' '}
          {isScriptedAi() ? 'AI results are pre-written samples, and email' : 'Email'} and QuickBooks
          are switched off.
        </div>
      )}
      {children}
    </NavShell>
  )
}
