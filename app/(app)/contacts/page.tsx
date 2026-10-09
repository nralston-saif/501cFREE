import { redirect } from 'next/navigation'

// The combined contacts list was replaced by Organizations and People
// (global search covers finding anyone).
export default function ContactsPage() {
  redirect('/organizations')
}
