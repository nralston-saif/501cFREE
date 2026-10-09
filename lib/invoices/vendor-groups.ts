import { normalizeName } from '@/lib/quickbooks/match'

/**
 * Pure helpers for proposing new vendors from a batch of uploaded invoices.
 * Files whose payee names overlap (after normalizing case, punctuation and
 * LLC/Inc suffixes) are one vendor, so two invoices from the same new vendor
 * create it once.
 */

export type VendorCandidate = {
  key: string
  vendor_name: string | null
  vendor_other_names: string[]
  vendor_type: 'organization' | 'individual'
}

export type NewVendorGroup = {
  /** Stable id: the normalized primary name of the first file in the group. */
  id: string
  name: string
  type: 'organization' | 'individual'
  rowKeys: string[]
}

export function namesOf(c: Pick<VendorCandidate, 'vendor_name' | 'vendor_other_names'>): string[] {
  return [c.vendor_name, ...c.vendor_other_names]
    .filter((n): n is string => Boolean(n))
    .map(normalizeName)
    .filter((n) => n !== '')
}

/** The existing vendor whose name matches any name on the document, if any. */
export function findVendorByNames<T extends { display_name: string }>(
  names: string[],
  vendors: T[]
): T | null {
  if (names.length === 0) return null
  return vendors.find((v) => names.includes(normalizeName(v.display_name))) ?? null
}

/** Group unmatched candidates into proposed new vendors, in batch order. */
export function groupNewVendors(candidates: VendorCandidate[]): NewVendorGroup[] {
  const groups: (NewVendorGroup & { names: Set<string> })[] = []
  for (const c of candidates) {
    const names = namesOf(c)
    if (!c.vendor_name || names.length === 0) continue
    const overlapping = groups.filter((g) => names.some((n) => g.names.has(n)))
    if (overlapping.length === 0) {
      groups.push({ id: names[0], name: c.vendor_name, type: c.vendor_type, rowKeys: [c.key], names: new Set(names) })
      continue
    }
    // Merge every group this file bridges into the first one.
    const [target, ...rest] = overlapping
    target.rowKeys.push(c.key)
    names.forEach((n) => target.names.add(n))
    for (const other of rest) {
      target.rowKeys.push(...other.rowKeys)
      other.names.forEach((n) => target.names.add(n))
      groups.splice(groups.indexOf(other), 1)
    }
  }
  // Drop the internal name set from the public shape.
  return groups.map(({ id, name, type, rowKeys }) => ({ id, name, type, rowKeys }))
}
