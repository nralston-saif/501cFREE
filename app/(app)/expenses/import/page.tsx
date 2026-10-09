import { redirect } from 'next/navigation'

// Single-invoice import was replaced by bulk upload; keep old links working.
export default function ImportInvoicePage() {
  redirect('/expenses/upload')
}
