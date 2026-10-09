import { redirect } from 'next/navigation'
import { getAuthState } from '@/lib/auth'

// Finance is admin territory (RLS limits expenses and QuickBooks data to
// admins): staff don't see the nav items, and this layout gates every nested
// route as the backstop.
export default async function AdminOnlyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isAdmin } = await getAuthState()
  if (!isAdmin) {
    redirect('/')
  }
  return <>{children}</>
}
