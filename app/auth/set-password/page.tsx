import { redirect } from 'next/navigation'
import { getAuthState } from '@/lib/auth'
import { safeNextPath } from '@/lib/site-url'
import AuthCard from '@/components/AuthCard'
import SetPasswordForm from './SetPasswordForm'

// Where invite and password-reset links land (via /auth/callback): the user is
// already signed in from the email link and picks a password for next time.
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { userId, memberId, memberName } = await getAuthState()
  if (!userId) redirect('/login')
  if (!memberId) redirect('/access-denied')

  const next = safeNextPath((await searchParams).next)

  return (
    <AuthCard
      title={memberName ? `Welcome, ${memberName.split(/\s+/)[0]}` : 'Welcome'}
      subtitle="Choose a password for signing in"
    >
      <SetPasswordForm next={next} />
    </AuthCard>
  )
}
