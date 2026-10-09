import type { Contact, OrgSettings } from '@/lib/supabase/types/database'

// Fictional fixtures shared by unit tests. Every name, address and number
// here is invented; EINs use the 00-0000000 placeholder style.

export function makeOrgSettings(overrides: Partial<OrgSettings> = {}): OrgSettings {
  return {
    id: 1,
    org_legal_name: 'Example Foundation Inc.',
    org_display_name: null,
    org_aliases: [],
    ein: '00-0000000',
    address_line1: '100 Example Ave',
    address_line2: null,
    city: 'Springfield',
    state: 'IL',
    postal_code: '62701',
    country: 'US',
    website_url: 'https://example.org',
    mission_statement: 'Improving literacy outcomes for children in rural communities.',
    timezone: 'America/Chicago',
    fiscal_year_start_month: 1,
    pri_board_approval_threshold_cents: null,
    public_charity_status: '509a1',
    grant_review_mode: 'all_members',
    letter_templates: {},
    letter_signatory_name: 'Alex Rivera',
    letter_signatory_title: 'President',
    letter_from_email: 'letters@example.org',
    letter_closing_text: 'Thank you again for your support.',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

export function makeContact(overrides: Partial<Contact> = {}): Contact {
  const kind = overrides.kind ?? 'person'
  const first = overrides.first_name !== undefined ? overrides.first_name : kind === 'person' ? 'Jane' : null
  const last = overrides.last_name !== undefined ? overrides.last_name : kind === 'person' ? 'Donor' : null
  const name = overrides.name ?? null
  const display =
    kind === 'organization'
      ? name ?? 'Example Org'
      : [first, last].filter(Boolean).join(' ') || name || 'Unnamed'
  return {
    id: 'c1',
    kind,
    name,
    first_name: first,
    last_name: last,
    display_name: display,
    is_donor: false,
    is_grantee: false,
    is_funder: false,
    is_vendor: false,
    is_lead: false,
    email: null,
    alternative_emails: [],
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    title: null,
    linkedin_url: null,
    website: null,
    description: null,
    image_path: null,
    twitter_url: null,
    entity_type: null,
    previous_names: [],
    legal_name: null,
    tax_id: null,
    tax_status: null,
    w9_on_file: false,
    qbo_vendor_id: null,
    notes: null,
    tags: [],
    introduced_by: null,
    first_met_date: null,
    how_we_met: null,
    relationship_notes: null,
    is_active: true,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}
