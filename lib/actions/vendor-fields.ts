import type { ContactKind } from '@/lib/supabase/types/database'
import { nameFieldsFor, parseContactKind } from '@/lib/contacts/names'

export interface NewVendorInput {
  name: string
  kind: ContactKind
  tax_id?: string | null
  w9_on_file?: boolean
}

/**
 * Pure mapping from the inline "add vendor" form to a contacts insert.
 * Always flags the contact as a vendor. Kept free of server imports so it can
 * be unit-tested without the server-action runtime.
 */
export function vendorFieldsFromInput(input: NewVendorInput) {
  const kind = parseContactKind(input.kind)
  const taxId = input.tax_id?.trim()
  return {
    kind,
    ...nameFieldsFor(kind, input.name),
    is_vendor: true as const,
    tax_id: taxId ? taxId : null,
    w9_on_file: Boolean(input.w9_on_file),
  }
}
