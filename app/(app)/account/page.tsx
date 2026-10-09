import PageHeader from '@/components/PageHeader'
import ChangePasswordForm from './ChangePasswordForm'

// Personal account settings — available to every active member (the org-wide
// Settings page stays admin-only).
export default function AccountPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Account" description="Your personal sign-in settings" />
      <ChangePasswordForm />
    </div>
  )
}
