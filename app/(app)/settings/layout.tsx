import { redirect } from 'next/navigation'
import { getAuthState } from '@/lib/auth'

// Settings and everything under it (incl. /settings/activity) is admin-only
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isAdmin } = await getAuthState()
  if (!isAdmin) {
    redirect('/')
  }
  return <>{children}</>
}
