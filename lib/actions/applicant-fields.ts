import type { ContactKind } from '@/lib/supabase/types/database'
import { nameFieldsFor, parseContactKind } from '@/lib/contacts/names'

export interface NewApplicantInput {
  name: string
  kind: ContactKind
}

/**
 * Pure mapping from the inline "create applicant" affordance on the new
 * proposal form to a contacts insert. Always flags the contact as a grantee.
 * Kept free of server imports so it can be unit-tested without the
 * server-action runtime.
 */
export function applicantFieldsFromInput(input: NewApplicantInput) {
  const kind = parseContactKind(input.kind)
  return {
    kind,
    ...nameFieldsFor(kind, input.name),
    is_grantee: true as const,
  }
}
