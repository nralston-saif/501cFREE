import { redirect } from 'next/navigation'

// Older "add a contact" links: new contacts are added from Organizations or
// People. Most links here come from vendor and grantee flows, so default to
// adding an organization.
export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const { kind } = await searchParams
  redirect(kind === 'person' ? '/people?add=1' : '/organizations?add=1')
}
