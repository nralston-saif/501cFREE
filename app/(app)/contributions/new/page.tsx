import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import PageHeader from '@/components/PageHeader'
import ContributionForm from './ContributionForm'

export default async function NewContributionPage() {
  const supabase = await createClient()
  const contacts = await loadContactOptions(supabase)

  return (
    <div>
      <PageHeader
        title="Record contribution"
        description="Log a donation and generate the IRS acknowledgement letter"
      />
      <div className="max-w-2xl">
        <ContributionForm contacts={contacts} />
      </div>
    </div>
  )
}
