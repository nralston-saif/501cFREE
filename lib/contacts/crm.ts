import type {
  AffiliationRelationship,
  Contact,
  ContactEntityType,
} from '@/lib/supabase/types/database'

// Shared vocabulary for the CRM pages (Organizations, People). Import-free
// (type-only) so client components can use it.

/** Role flags a contact can carry; one contact can play several roles. */
export type ContactRoleFlag = 'is_donor' | 'is_grantee' | 'is_funder' | 'is_vendor' | 'is_lead'

export const ROLE_FLAGS: { flag: ContactRoleFlag; label: string; plural: string }[] = [
  { flag: 'is_donor', label: 'Donor', plural: 'Donors' },
  { flag: 'is_grantee', label: 'Grantee', plural: 'Grantees' },
  { flag: 'is_funder', label: 'Funder', plural: 'Funders' },
  { flag: 'is_vendor', label: 'Vendor', plural: 'Vendors' },
  { flag: 'is_lead', label: 'Lead', plural: 'Leads' },
]

/** Badge colors per role, matching across list cards and detail headers. */
export const ROLE_BADGE_CLASSES: Record<ContactRoleFlag, string> = {
  is_donor: 'bg-emerald-100 text-emerald-800',
  is_grantee: 'bg-blue-100 text-blue-800',
  is_funder: 'bg-violet-100 text-violet-800',
  is_vendor: 'bg-gray-100 text-gray-700',
  is_lead: 'bg-amber-100 text-amber-800',
}

export function contactRoles(c: Pick<Contact, ContactRoleFlag>): ContactRoleFlag[] {
  return ROLE_FLAGS.filter((r) => c[r.flag]).map((r) => r.flag)
}

export const RELATIONSHIP_LABELS: Record<AffiliationRelationship, string> = {
  founder: 'Founder',
  executive: 'Executive',
  employee: 'Staff',
  board_member: 'Board member',
  advisor: 'Advisor',
  contact: 'Contact',
  other: 'Other',
}

/** Display order for relationship pickers. */
export const RELATIONSHIP_OPTIONS: AffiliationRelationship[] = [
  'executive',
  'founder',
  'employee',
  'board_member',
  'advisor',
  'contact',
  'other',
]

/** Relationships shown in an organization's Leadership section; the rest
 * are its Team. */
export const LEADERSHIP_RELATIONSHIPS: AffiliationRelationship[] = ['founder', 'executive']

export const ENTITY_TYPE_LABELS: Record<ContactEntityType, string> = {
  nonprofit: 'Nonprofit',
  for_profit: 'For-profit',
  pbc: 'Public benefit corp.',
  government: 'Government',
  other: 'Other',
}

/** Filter pills on the People list. Leadership, Staff, Board and Advisors
 * come from current affiliations; Donors and Leads from role flags. */
export type PeopleFilter = 'all' | 'leadership' | 'staff' | 'board' | 'advisors' | 'donors' | 'leads'

export const PEOPLE_FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'leadership', label: 'Leadership' },
  { key: 'staff', label: 'Staff' },
  { key: 'board', label: 'Board' },
  { key: 'advisors', label: 'Advisors' },
  { key: 'donors', label: 'Donors' },
  { key: 'leads', label: 'Leads' },
]

export const PEOPLE_FILTER_RELATIONSHIPS: Partial<Record<PeopleFilter, AffiliationRelationship[]>> = {
  leadership: LEADERSHIP_RELATIONSHIPS,
  staff: ['employee'],
  board: ['board_member'],
  advisors: ['advisor'],
}

/** Filter pills on the Organizations list: All, one per role flag, and
 * Archived (inactive). */
export type OrganizationFilter = 'all' | ContactRoleFlag | 'archived'

/** Storage folder for a contact's logo or photo (documents bucket). */
export function contactImageFolder(contactId: string): string {
  return `contact-images/${contactId}`
}

/** Initials for an avatar placeholder. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Badge colors per affiliation relationship (People cards). */
export const RELATIONSHIP_BADGE_CLASSES: Record<AffiliationRelationship, string> = {
  founder: 'bg-purple-100 text-purple-800',
  executive: 'bg-indigo-100 text-indigo-800',
  employee: 'bg-gray-100 text-gray-800',
  board_member: 'bg-emerald-100 text-emerald-800',
  advisor: 'bg-amber-100 text-amber-800',
  contact: 'bg-slate-100 text-slate-700',
  other: 'bg-slate-100 text-slate-700',
}

/** An external link with a scheme, for websites typed without one. */
export function externalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/** True if `path` is an object inside this contact's image folder. */
export function isContactImagePath(contactId: string, path: string | null | undefined): path is string {
  return !!path && path.startsWith(`${contactImageFolder(contactId)}/`) && !path.includes('..')
}

/** Image types accepted for logos/photos (no SVG: it can carry script). */
export const CONTACT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_CONTACT_IMAGE_BYTES = 5 * 1024 * 1024

/** The calendar day (YYYY-MM-DD) of a timestamp in `timeZone` (UTC if the zone is unknown). */
export function dateInTimeZone(timestamp: string, timeZone: string): string {
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return timestamp.slice(0, 10)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/**
 * The calendar day (YYYY-MM-DD) of a meeting's timestamp. Meetings created in
 * the app store a date as midnight UTC, which is that date as typed; any
 * other time of day is a real moment, shown on the organization's day.
 */
export function meetingDay(meetingDate: string, timeZone: string): string {
  const at = new Date(meetingDate)
  if (!Number.isNaN(at.getTime()) && at.getTime() % 86_400_000 === 0) return at.toISOString().slice(0, 10)
  return dateInTimeZone(meetingDate, timeZone)
}
