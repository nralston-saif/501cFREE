import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Stable link to any contact: forwards to its Organization or Person page,
// so code that only knows a contact id can link here.
export default async function ContactRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('contacts').select('kind').eq('id', id).maybeSingle()
  const contact = data as { kind: 'person' | 'organization' } | null
  if (!contact) notFound()
  redirect(contact.kind === 'person' ? `/people/${id}` : `/organizations/${id}`)
}
