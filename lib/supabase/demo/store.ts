/**
 * In-memory data store for demo mode (the default unless
 * NEXT_PUBLIC_USE_SUPABASE=true and Supabase is configured). Lets the app run
 * as a proof of concept with no database. Data lives in module memory: writes
 * work but reset on server restart / new serverless instance.
 *
 * Everything here is fictional: an invented literacy nonprofit, example.org /
 * example.com addresses, 00-0000000-style EINs.
 */

export const DEMO_AUTH_USER_ID = '00000000-0000-0000-0000-00000000d390'
export const DEMO_USER_EMAIL = 'demo@example.org'

type Row = Record<string, unknown>

interface DemoStore {
  tables: Record<string, Row[]>
  files: Map<string, { bytes: Uint8Array; contentType: string }>
  /** Date.now() when seeded; the store reseeds after DEMO_RESET_MS */
  seededAt: number
}

/** A public demo forgets visitors' changes and uploads this often */
export const DEMO_RESET_MS = 6 * 60 * 60 * 1000

// Stable ids so seeded relations hold together
const ids = {
  alex: '00000000-0000-0000-0000-000000000101',
  sam: '00000000-0000-0000-0000-000000000102',
  jordan: '00000000-0000-0000-0000-000000000103',
  casey: '00000000-0000-0000-0000-000000000104',
  donorJane: '00000000-0000-0000-0000-000000000201',
  donorMapleFdn: '00000000-0000-0000-0000-000000000202',
  granteeReaders: '00000000-0000-0000-0000-000000000203',
  granteeLibraries: '00000000-0000-0000-0000-000000000204',
  funderCommunity: '00000000-0000-0000-0000-000000000205',
  vendorAcct: '00000000-0000-0000-0000-000000000206',
  priRecipient: '00000000-0000-0000-0000-000000000207',
  personMorgan: '00000000-0000-0000-0000-000000000208',
  personLee: '00000000-0000-0000-0000-000000000209',
  contribution1: '00000000-0000-0000-0000-000000000301',
  contribution2: '00000000-0000-0000-0000-000000000302',
  contribution3: '00000000-0000-0000-0000-000000000303',
  contribution4: '00000000-0000-0000-0000-000000000304',
  catGrants: '00000000-0000-0000-0000-000000000401',
  catAccounting: '00000000-0000-0000-0000-000000000402',
  catSoftware: '00000000-0000-0000-0000-000000000403',
  catTravel: '00000000-0000-0000-0000-000000000404',
  catLegal: '00000000-0000-0000-0000-000000000405',
  catInsurance: '00000000-0000-0000-0000-000000000406',
  catFundraising: '00000000-0000-0000-0000-000000000407',
  proposal1: '00000000-0000-0000-0000-000000000501',
  proposal2: '00000000-0000-0000-0000-000000000502',
  proposal3: '00000000-0000-0000-0000-000000000503',
  proposal4: '00000000-0000-0000-0000-000000000504',
  proposal5: '00000000-0000-0000-0000-000000000505',
  award1: '00000000-0000-0000-0000-000000000601',
  disb1: '00000000-0000-0000-0000-000000000701',
  disb2: '00000000-0000-0000-0000-000000000702',
  inquiry1: '00000000-0000-0000-0000-000000000901',
  inquiry2: '00000000-0000-0000-0000-000000000902',
  pri1: '00000000-0000-0000-0000-000000000e01',
  meeting1: '00000000-0000-0000-0000-000000000f01',
  note1: '00000000-0000-0000-0000-000000001001',
  note2: '00000000-0000-0000-0000-000000001002',
  ticket1: '00000000-0000-0000-0000-000000001101',
  ticket2: '00000000-0000-0000-0000-000000001102',
}

function ts(date: string): { created_at: string; updated_at: string } {
  return { created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` }
}

/** A full contacts row; display_name mirrors the generated column */
function contact(fields: Row & { id: string; kind: 'person' | 'organization' }, date: string): Row {
  const row: Row = {
    name: null,
    first_name: null,
    last_name: null,
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
    country: 'US',
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
    created_by: ids.alex,
    ...ts(date),
    ...fields,
  }
  row.display_name = contactDisplayName(row)
  return row
}

/** Mirrors the generated contacts.display_name column (migration 0002) */
export function contactDisplayName(row: Record<string, unknown>): string | null {
  if (row.kind === 'organization') return (row.name as string | null) ?? null
  const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return full || ((row.name as string | null) ?? null)
}

/** A pending Banking item, shaped like a pulled QuickBooks transaction */
function qboItem(
  id: string,
  entityType: 'Purchase' | 'Deposit' | 'Transfer',
  qboId: string,
  date: string,
  amountCents: number,
  direction: 'money_in' | 'money_out' | null,
  counterparty: string | null,
  memo: string,
  suggestion: Row
): Row {
  return {
    id,
    qbo_entity_type: entityType,
    qbo_entity_id: qboId,
    kind: 'new',
    status: 'pending',
    raw: { Id: qboId, TxnDate: date, TotalAmt: amountCents / 100, PrivateNote: memo },
    previous_raw: null,
    txn_date: date,
    amount_cents: amountCents,
    direction,
    counterparty_name: counterparty,
    qbo_payment_account_id: null,
    qbo_line_account_ids: [],
    qbo_doc_number: null,
    qbo_private_note: memo,
    suggestion,
    resolution: null,
    dismiss_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    expense_id: null,
    contribution_id: null,
    disbursement_id: null,
    pri_id: null,
    first_seen_at: `${date}T18:00:00Z`,
    ...ts(date),
  }
}

const noQbo = {
  qbo_purchase_id: null,
  qbo_sync_status: 'not_synced',
  qbo_synced_at: null,
  qbo_sync_error: null,
  qbo_source: 'app',
}

const DECLINE_DRAFT = `Subject: Your proposal to the Example Literacy Fund

Dear Pat,

Thank you for sharing your billboard campaign proposal with us. We appreciate the energy behind getting more families excited about reading.

After careful review, we have decided not to fund this proposal. Our grants support direct reading programs with outcomes we can measure, and broad awareness advertising falls outside our current grantmaking focus.

We wish you the very best with the campaign.

Warmly,
The Example Literacy Fund Team`

function buildSeedTables(): Record<string, Row[]> {
  return {
    team_members: [
      { id: ids.alex, auth_user_id: DEMO_AUTH_USER_ID, email: DEMO_USER_EMAIL, full_name: 'Demo', is_active: true, role: 'admin', ...ts('2026-01-05') },
      { id: ids.sam, auth_user_id: null, email: 'sam@example.org', full_name: 'Sam Patel', is_active: true, role: 'admin', ...ts('2026-01-05') },
      { id: ids.jordan, auth_user_id: null, email: 'jordan@example.org', full_name: 'Jordan Blake', is_active: true, role: 'admin', ...ts('2026-01-05') },
      { id: ids.casey, auth_user_id: null, email: 'casey@example.org', full_name: 'Casey Nguyen', is_active: true, role: 'staff', ...ts('2026-02-01') },
    ],
    org_settings: [
      {
        id: 1,
        org_legal_name: 'Example Literacy Fund Inc.',
        org_display_name: 'Example Literacy Fund',
        org_aliases: ['ELF', 'Example Literacy'],
        ein: '00-0000000',
        address_line1: '100 Example Ave',
        address_line2: 'Suite 200',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
        country: 'US',
        website_url: 'https://example.org',
        mission_statement:
          'The Example Literacy Fund helps every child in rural communities become a confident reader by funding early-literacy programs, family engagement and teacher training.',
        timezone: 'America/Chicago',
        fiscal_year_start_month: 1,
        pri_board_approval_threshold_cents: 25_000_000,
        public_charity_status: '509a1',
        grant_review_mode: 'all_members',
        letter_templates: {},
        letter_signatory_name: 'Alex Rivera',
        letter_signatory_title: 'Executive Director',
        letter_from_email: 'letters@example.org',
        letter_closing_text: 'Thank you for your generous support of our mission.',
        ...ts('2026-01-05'),
      },
    ],
    program_areas: [
      { slug: 'early-literacy', label: 'Early literacy', description: 'Reading programs for children ages 3-8', sort_order: 10, is_active: true, ...ts('2026-01-05') },
      { slug: 'family-engagement', label: 'Family engagement', description: 'Helping parents and caregivers read with their children', sort_order: 20, is_active: true, ...ts('2026-01-05') },
      { slug: 'teacher-training', label: 'Teacher training', description: 'Professional development for reading instruction', sort_order: 30, is_active: true, ...ts('2026-01-05') },
    ],
    contacts: [
      contact({ id: ids.donorJane, kind: 'person', first_name: 'Jane', last_name: 'Donor', email: 'jane.donor@example.com', phone: '555-0101', address_line1: '1 Main St', city: 'Springfield', state: 'IL', postal_code: '62704', is_donor: true }, '2026-01-12'),
      contact({ id: ids.donorMapleFdn, kind: 'organization', name: 'Maple Family Foundation', legal_name: 'Maple Family Foundation', email: 'grants@maple.example.org', address_line1: '200 Park Ave', city: 'Riverton', state: 'IL', postal_code: '62561', tax_id: '00-0000001', tax_status: '501c3_private_foundation', entity_type: 'nonprofit', is_donor: true, is_funder: true, notes: 'Family foundation focused on childhood education.' }, '2026-01-20'),
      contact({ id: ids.granteeReaders, kind: 'organization', name: 'Riverbend Readers', legal_name: 'Riverbend Readers Inc.', email: 'hello@riverbend.example.org', address_line1: '77 Library Way', city: 'Riverbend', state: 'IL', postal_code: '62200', tax_id: '00-0000002', tax_status: '501c3_public_charity', entity_type: 'nonprofit', is_grantee: true }, '2026-02-01'),
      contact({ id: ids.granteeLibraries, kind: 'organization', name: 'Prairie Libraries Network', legal_name: 'Prairie Libraries Network', email: 'office@prairielibraries.example.org', city: 'Lincoln', state: 'NE', tax_id: '00-0000003', tax_status: '501c3_public_charity', entity_type: 'nonprofit', is_grantee: true, is_lead: true }, '2026-03-10'),
      contact({ id: ids.funderCommunity, kind: 'organization', name: 'Example Community Foundation', email: 'programs@communityfdn.example.org', city: 'Springfield', state: 'IL', entity_type: 'nonprofit', is_funder: true }, '2026-02-15'),
      contact({ id: ids.priRecipient, kind: 'organization', name: 'Brightpath Tools, PBC', legal_name: 'Brightpath Tools, PBC', email: 'team@brightpath.example.com', city: 'Chicago', state: 'IL', tax_status: 'for_profit', entity_type: 'pbc', notes: 'Low-cost reading-assessment software for rural schools. PRI recipient.' }, '2026-04-01'),
      contact({ id: ids.vendorAcct, kind: 'organization', name: 'Ledger & Co. Accounting LLP', email: 'billing@ledgerco.example.com', city: 'Springfield', state: 'IL', tax_id: '00-0000004', entity_type: 'for_profit', is_vendor: true, w9_on_file: true }, '2026-01-15'),
      contact({ id: ids.personMorgan, kind: 'person', first_name: 'Morgan', last_name: 'Lee', title: 'Executive Director', email: 'morgan@riverbend.example.org' }, '2026-02-01'),
      contact({ id: ids.personLee, kind: 'person', first_name: 'Lee', last_name: 'Park', title: 'Grants Manager', email: 'lee@maple.example.org' }, '2026-01-20'),
    ],
    affiliations: [
      { id: '00000000-0000-0000-0000-000000001201', person_id: ids.personMorgan, organization_id: ids.granteeReaders, relationship: 'executive', title: 'Executive Director', is_primary_contact: true, start_date: null, end_date: null, ...ts('2026-02-01') },
      { id: '00000000-0000-0000-0000-000000001202', person_id: ids.personLee, organization_id: ids.donorMapleFdn, relationship: 'employee', title: 'Grants Manager', is_primary_contact: true, start_date: null, end_date: null, ...ts('2026-01-20') },
    ],
    notes: [
      { id: ids.note1, content: 'Call with Morgan: the summer reading pilot reached 140 children across six sites. They want to add two more counties next year.', note_date: '2026-06-12', author_id: ids.sam, ...ts('2026-06-12') },
      { id: ids.note2, content: 'Lee confirmed the Maple board meets in October; a renewal request should arrive before September 15.', note_date: '2026-07-02', author_id: ids.alex, ...ts('2026-07-02') },
    ],
    note_links: [
      { id: '00000000-0000-0000-0000-000000001301', note_id: ids.note1, entity_type: 'contact', entity_id: ids.granteeReaders, is_primary: true, created_at: '2026-06-12T12:00:00Z' },
      { id: '00000000-0000-0000-0000-000000001302', note_id: ids.note1, entity_type: 'contact', entity_id: ids.personMorgan, is_primary: false, created_at: '2026-06-12T12:00:00Z' },
      { id: '00000000-0000-0000-0000-000000001303', note_id: ids.note2, entity_type: 'contact', entity_id: ids.donorMapleFdn, is_primary: true, created_at: '2026-07-02T12:00:00Z' },
    ],
    note_attachments: [],
    note_intakes: [],
    note_intake_files: [],
    meetings: [
      { id: ids.meeting1, title: 'Grants review: summer cycle', meeting_date: '2026-07-08', content: 'Reviewed the library network proposal and the reading-tutor application.\n\n- Ask the library network for county-level circulation data\n- Schedule a site visit with Riverbend Readers in August', created_by: ids.alex, ...ts('2026-07-08') },
    ],
    meeting_attendees: [
      { id: '00000000-0000-0000-0000-000000001401', meeting_id: ids.meeting1, contact_id: ids.personMorgan, created_by: ids.alex, created_at: '2026-07-08T12:00:00Z' },
    ],
    tags: [
      { id: '00000000-0000-0000-0000-000000001501', name: 'follow-up', color: '#2563eb', usage_count: 1, created_by: ids.alex, ...ts('2026-06-01') },
    ],
    tickets: [
      { id: ids.ticket1, title: 'Send W-9 request to Brightpath Tools', description: 'Needed before the next PRI tranche.', status: 'open', priority: 'medium', due_date: '2026-08-15', assigned_to: ids.casey, created_by: ids.alex, contact_id: ids.priRecipient, tags: ['follow-up'], is_flagged: false, closed_at: null, ...ts('2026-07-20') },
      { id: ids.ticket2, title: 'Collect progress report from Riverbend Readers', description: null, status: 'in_progress', priority: 'high', due_date: '2026-07-31', assigned_to: ids.sam, created_by: ids.sam, contact_id: ids.granteeReaders, tags: [], is_flagged: true, closed_at: null, ...ts('2026-07-01') },
    ],
    ticket_comments: [
      { id: '00000000-0000-0000-0000-000000001601', ticket_id: ids.ticket2, author_id: ids.sam, content: 'Morgan says the report is with their board treasurer for sign-off.', is_resolution: false, ...ts('2026-07-15') },
    ],
    contributions: [
      { id: ids.contribution1, contact_id: ids.donorJane, amount_cents: 250_000, received_date: '2026-03-15', method: 'wire', vehicle: 'daf', vehicle_sponsor_name: 'Example Giving Fund', in_kind_description: null, restriction: 'unrestricted', restriction_purpose: null, quid_pro_quo: false, goods_services_description: null, goods_services_value_cents: null, check_number: null, notes: null, entered_by: ids.alex, qbo_txn_type: null, qbo_txn_id: null, ...ts('2026-03-15') },
      { id: ids.contribution2, contact_id: ids.donorJane, amount_cents: 50_000, received_date: '2026-05-01', method: 'check', vehicle: 'direct', vehicle_sponsor_name: null, in_kind_description: null, restriction: 'unrestricted', restriction_purpose: null, quid_pro_quo: true, goods_services_description: 'two benefit dinner tickets', goods_services_value_cents: 15_000, check_number: '1042', notes: null, entered_by: ids.sam, qbo_txn_type: null, qbo_txn_id: null, ...ts('2026-05-01') },
      { id: ids.contribution3, contact_id: ids.donorMapleFdn, amount_cents: 5_000_000, received_date: '2026-04-20', method: 'ach', vehicle: 'private_foundation', vehicle_sponsor_name: null, in_kind_description: null, restriction: 'donor_restricted', restriction_purpose: 'Teacher training programs', quid_pro_quo: false, goods_services_description: null, goods_services_value_cents: null, check_number: null, notes: null, entered_by: ids.alex, qbo_txn_type: null, qbo_txn_id: null, ...ts('2026-04-20') },
      { id: ids.contribution4, contact_id: ids.donorJane, amount_cents: 197_850, received_date: '2026-06-03', method: 'stock', vehicle: 'direct', vehicle_sponsor_name: null, in_kind_description: null, restriction: 'unrestricted', restriction_purpose: null, quid_pro_quo: false, goods_services_description: null, goods_services_value_cents: null, check_number: null, notes: 'Demo stock gift with internal FMV from broker statement.', entered_by: ids.alex, qbo_txn_type: null, qbo_txn_id: null, ...ts('2026-06-03') },
    ],
    acknowledgement_letters: [],
    security_prices: [
      { id: '00000000-0000-0000-0000-000000000d01', symbol: 'AAPL', price_date: '2026-06-03', open_cents: null, high_cents: null, low_cents: null, close_cents: 19_785, adjusted_close_cents: null, volume: 52_000_000, source: 'fmp', fetched_at: '2026-06-03T21:00:00Z', ...ts('2026-06-03') },
    ],
    stock_contribution_details: [
      { contribution_id: ids.contribution4, security_name: 'Apple Inc. common stock', ticker_symbol: 'AAPL', cusip: '037833100', shares: 10, valuation_date: '2026-06-03', fmv_per_share_cents: 19_785, fmv_total_cents: 197_850, valuation_source: 'broker_statement', market_price_source: 'fmp', brokerage_account: 'Demo brokerage account', transfer_received_date: '2026-06-03', sale_date: null, sale_gross_cents: null, sale_fees_cents: null, sale_net_cents: null, notes: 'Broker statement attached in a real workflow.', ...ts('2026-06-03') },
    ],
    donation_inquiries: [
      { id: ids.inquiry1, name: 'Priya Raman', email: 'priya.raman@example.com', phone: '555-0142', organization: null, gift_method: 'stock_crypto', amount_cents: 5_000_000, amount_text: '50000', message: 'Interested in gifting appreciated shares before year end. What do you need from me?', status: 'new', source: 'website', ...ts('2026-06-22') },
      { id: ids.inquiry2, name: 'Daniel Ortiz', email: 'dortiz@example.com', phone: null, organization: 'Ortiz Family Giving Fund', gift_method: 'daf', amount_cents: null, amount_text: 'TBD, likely $10k-25k', message: 'Recommending a grant through our DAF; please confirm legal name and EIN.', status: 'contacted', source: 'website', ...ts('2026-06-18') },
    ],
    expense_categories: [
      { id: ids.catGrants, name: 'Grants paid', functional_class: 'program', form_990_line: 'Part IX line 1', system_key: 'grants_paid', is_active: true, ...ts('2026-01-05') },
      { id: ids.catAccounting, name: 'Accounting fees', functional_class: 'management_general', form_990_line: 'Part IX line 11c', system_key: null, is_active: true, ...ts('2026-01-05') },
      { id: ids.catLegal, name: 'Legal fees', functional_class: 'management_general', form_990_line: 'Part IX line 11b', system_key: null, is_active: true, ...ts('2026-01-05') },
      { id: ids.catSoftware, name: 'Software & IT', functional_class: 'management_general', form_990_line: 'Part IX line 14', system_key: null, is_active: true, ...ts('2026-01-05') },
      { id: ids.catInsurance, name: 'Insurance', functional_class: 'management_general', form_990_line: 'Part IX line 23', system_key: null, is_active: true, ...ts('2026-01-05') },
      { id: ids.catTravel, name: 'Travel', functional_class: 'program', form_990_line: 'Part IX line 17', system_key: null, is_active: true, ...ts('2026-01-05') },
      { id: ids.catFundraising, name: 'Fundraising events', functional_class: 'fundraising', form_990_line: 'Part IX line 24', system_key: null, is_active: true, ...ts('2026-01-05') },
    ],
    expenses: [
      { id: '00000000-0000-0000-0000-000000000a91', expense_date: '2026-04-10', amount_cents: 120_000, description: 'Annual 990 preparation', category_id: ids.catAccounting, vendor_contact_id: ids.vendorAcct, payment_method: 'ach', status: 'paid', paid_by: null, is_1099_eligible: true, disbursement_id: null, notes: null, entered_by: ids.alex, ...noQbo, ...ts('2026-04-10') },
      { id: '00000000-0000-0000-0000-000000000a92', expense_date: '2026-05-22', amount_cents: 8_900, description: 'Office software subscription (May)', category_id: ids.catSoftware, vendor_contact_id: null, payment_method: 'card', status: 'paid', paid_by: null, is_1099_eligible: false, disbursement_id: null, notes: null, entered_by: ids.jordan, ...noQbo, ...ts('2026-05-22') },
      { id: '00000000-0000-0000-0000-000000000a93', expense_date: '2026-06-02', amount_cents: 64_250, description: 'Mileage and lodging: grantee site visit', category_id: ids.catTravel, vendor_contact_id: null, payment_method: 'reimbursement', status: 'pending', paid_by: ids.sam, is_1099_eligible: false, disbursement_id: null, notes: 'Paid personally; to be reimbursed', entered_by: ids.sam, ...noQbo, ...ts('2026-06-02') },
      { id: '00000000-0000-0000-0000-000000000a94', expense_date: '2026-05-15', amount_cents: 1_000_000, description: 'Grant disbursement - Riverbend Readers: Summer reading corps', category_id: ids.catGrants, vendor_contact_id: ids.granteeReaders, payment_method: 'wire', status: 'paid', paid_by: null, is_1099_eligible: false, disbursement_id: ids.disb1, notes: null, entered_by: ids.alex, ...noQbo, ...ts('2026-05-15') },
    ],
    qbo_sync_state: [
      { id: 1, pull_enabled: false, auto_apply_enabled: false, pull_since: '2026-07-01', last_cdc_at: null, last_run_at: null, last_run_status: null, last_run_error: null, last_run_stats: null, updated_at: '2026-07-01T12:00:00Z' },
    ],
    // Sample bank-feed transactions waiting in Banking, as a QuickBooks pull
    // would leave them (demo mode can't connect to QuickBooks)
    qbo_inbox: [
      qboItem('00000000-0000-0000-0000-000000001701', 'Purchase', '9001', '2026-07-01', 1_750_000, 'money_out', 'Riverbend Readers', 'Wire to Riverbend Readers', {
        type: 'disbursement_paid',
        disbursement_id: ids.disb2,
        grant_out_id: ids.award1,
        grantee_name: 'Riverbend Readers',
        auto_apply: false,
        reason: 'Exact match: scheduled disbursement of the same amount to Riverbend Readers.',
      }),
      qboItem('00000000-0000-0000-0000-000000001702', 'Purchase', '9002', '2026-07-06', 8_900, 'money_out', 'Northwind Cloud Software', 'NORTHWIND CLOUD SOFTWARE 07/06', {
        type: 'new_expense',
        prefill: { expense_date: '2026-07-06', amount_cents: 8_900, description: 'Northwind Cloud Software', category_id: ids.catSoftware, payment_method: 'card', vendor_contact_id: null },
        reason: 'New transaction from QuickBooks with no matching record here.',
      }),
      qboItem('00000000-0000-0000-0000-000000001703', 'Deposit', '9003', '2026-07-09', 100_000, 'money_in', 'Jane Donor', 'Mobile check deposit', {
        type: 'new_contribution',
        prefill: { received_date: '2026-07-09', amount_cents: 100_000, contact_id: ids.donorJane, counterparty_name: 'Jane Donor' },
        reason: 'Deposit to an income account from Jane Donor — looks like a contribution.',
      }),
      qboItem('00000000-0000-0000-0000-000000001704', 'Transfer', '9004', '2026-07-10', 2_500_000, null, null, 'Transfer from savings', {
        type: 'dismiss',
        reason: 'Internal transfer between accounts — no record needed here.',
      }),
    ],
    qbo_mappings: [],
    grant_proposals: [
      { id: ids.proposal1, applicant_contact_id: ids.granteeReaders, title: 'Summer reading corps', summary: 'Twelve-month program placing trained reading tutors in rural summer programs across six counties.', program_areas: ['early-literacy', 'teacher-training'], amount_requested_cents: 5_000_000, received_date: '2026-03-01', entered_date: '2026-03-01', source: 'email', status: 'decided', origin: 'internal', applicant_name: null, applicant_email: null, organization_name: null, raw_submission: null, votes_revealed: true, decision: 'approved', decision_date: '2026-04-15', decision_notes: 'Strong team, clear milestones. Approved at the requested amount less the travel line.', declined_stage: null, draft_response_email: null, response_email_sent_at: null, ...ts('2026-03-01') },
      { id: ids.proposal2, applicant_contact_id: ids.granteeLibraries, title: 'Rural library book-mobile expansion', summary: 'Two additional book-mobiles serving 40 rural schools, with weekly family story hours.', program_areas: ['early-literacy', 'family-engagement'], amount_requested_cents: 7_500_000, received_date: '2026-05-20', entered_date: '2026-05-20', source: 'referral', status: 'diligence', origin: 'internal', applicant_name: null, applicant_email: null, organization_name: null, raw_submission: null, votes_revealed: true, decision: null, decision_date: null, decision_notes: null, declined_stage: null, draft_response_email: null, response_email_sent_at: null, ...ts('2026-05-20') },
      { id: ids.proposal3, applicant_contact_id: null, title: 'Read-at-home kits for new parents', summary: 'Six-month project distributing picture-book kits and reading guides to new parents through county health clinics.', program_areas: ['family-engagement'], amount_requested_cents: 3_000_000, received_date: '2026-07-18', entered_date: '2026-07-18', source: 'website', status: 'received', origin: 'external', applicant_name: 'Dana Rivers', applicant_email: 'dana@readyreaders.example.org', organization_name: 'Ready Readers Coalition', raw_submission: { applicant_name: 'Dana Rivers', applicant_email: 'dana@readyreaders.example.org', organization_name: 'Ready Readers Coalition', title: 'Read-at-home kits for new parents', program_areas: ['family-engagement'], amount_requested: '$30,000' }, votes_revealed: false, decision: null, decision_date: null, decision_notes: null, declined_stage: null, draft_response_email: null, response_email_sent_at: null, ...ts('2026-07-18') },
      { id: ids.proposal4, applicant_contact_id: null, title: 'Phonics coaching for first-year teachers', summary: 'Coaching cohort teaching structured phonics instruction to first-year rural teachers.', program_areas: ['teacher-training'], amount_requested_cents: 4_500_000, received_date: '2026-07-05', entered_date: '2026-07-05', source: 'website', status: 'in_review', origin: 'external', applicant_name: 'Sam Okafor', applicant_email: 'sam@teachread.example.org', organization_name: 'TeachRead Collaborative', raw_submission: { applicant_name: 'Sam Okafor', applicant_email: 'sam@teachread.example.org', organization_name: 'TeachRead Collaborative', title: 'Phonics coaching for first-year teachers', program_areas: ['teacher-training'], amount_requested: '$45,000' }, votes_revealed: false, decision: null, decision_date: null, decision_notes: null, declined_stage: null, draft_response_email: null, response_email_sent_at: null, ...ts('2026-07-05') },
      { id: ids.proposal5, applicant_contact_id: null, title: 'Reading awareness billboard campaign', summary: 'Statewide billboard campaign encouraging families to read together.', program_areas: [], amount_requested_cents: 20_000_000, received_date: '2026-06-10', entered_date: '2026-06-10', source: 'website', status: 'decided', origin: 'external', applicant_name: 'Pat Marlow', applicant_email: 'pat@bigsigns.example.com', organization_name: 'BigSigns Media', raw_submission: { applicant_name: 'Pat Marlow', applicant_email: 'pat@bigsigns.example.com', organization_name: 'BigSigns Media', title: 'Reading awareness billboard campaign', amount_requested: '$200,000' }, votes_revealed: true, decision: 'declined', decision_date: '2026-06-24', decision_notes: 'Broad awareness advertising is outside our program areas; no measurable reading outcome.', declined_stage: 'review', draft_response_email: DECLINE_DRAFT, response_email_sent_at: null, ...ts('2026-06-10') },
    ],
    proposal_reviews: [
      { id: '00000000-0000-0000-0000-000000000b01', proposal_id: ids.proposal2, reviewer_id: ids.sam, score: 4, vote: 'yes', comments: 'They have run one book-mobile for three years. Budget is reasonable.', recused: false, ...ts('2026-06-01') },
      { id: '00000000-0000-0000-0000-000000000b02', proposal_id: ids.proposal2, reviewer_id: ids.jordan, score: 3, vote: 'maybe', comments: 'Want to see letters of support from at least three school districts.', recused: false, ...ts('2026-06-03') },
      { id: '00000000-0000-0000-0000-000000000b03', proposal_id: ids.proposal2, reviewer_id: ids.alex, score: 4, vote: 'yes', comments: 'Exactly the kind of family-facing program we want to fund.', recused: false, ...ts('2026-06-04') },
      { id: '00000000-0000-0000-0000-000000000b04', proposal_id: ids.proposal4, reviewer_id: ids.sam, score: null, vote: 'yes', comments: null, recused: false, ...ts('2026-07-10') },
    ],
    proposal_comments: [
      { id: '00000000-0000-0000-0000-000000000c01', proposal_id: ids.proposal2, author_id: ids.sam, body: 'Spoke with their director on Tuesday: two districts have already signed letters of support.', ...ts('2026-06-02') },
      { id: '00000000-0000-0000-0000-000000000c02', proposal_id: ids.proposal2, author_id: ids.jordan, body: 'Good, two down. Let us ask for one more before deciding.', ...ts('2026-06-04') },
    ],
    proposal_memos: [
      {
        id: '00000000-0000-0000-0000-000000000d11',
        proposal_id: ids.proposal2,
        q_summary_recommendation: null,
        q_org_background: 'The network runs one book-mobile today, serving 18 schools. Staff of five; audited financials on file for the last two years.',
        q_cause_area_fit: 'Early literacy and family engagement: weekly access to books in schools without a library.',
        q_theory_of_change: 'Regular access to books plus family story hours increases home reading time, which predicts reading proficiency by third grade.',
        q_grant_size_structure: 'Amount justification: $75k covers two vehicles retrofitted and one year of a driver-librarian.\n\nAgreed output: 40 schools visited weekly by month 12, with circulation data reported quarterly.',
        q_counterfactual: null,
        q_success_disappointment: null,
        q_risks_mitigations: null,
        q_legal_compliance: null,
        q_monitoring_evaluation: null,
        header_purpose: null,
        header_structure: null,
        header_decision: null,
        header_grantee_descriptor: null,
        started_by: ids.sam,
        last_edited_by: ids.sam,
        ...ts('2026-06-05'),
      },
    ],
    grant_research: [],
    grant_memo_pdfs: [],
    grants_out: [
      { id: ids.award1, proposal_id: ids.proposal1, grantee_contact_id: ids.granteeReaders, purpose: 'Summer reading corps', amount_awarded_cents: 4_500_000, award_date: '2026-04-15', restriction: 'Program use only', agreement_signed_date: '2026-04-28', status: 'active', notes: null, ...ts('2026-04-15') },
    ],
    disbursements: [
      { id: ids.disb1, grant_out_id: ids.award1, amount_cents: 1_000_000, scheduled_date: '2026-05-15', paid_date: '2026-05-15', method: 'wire', status: 'paid', ...ts('2026-04-28') },
      { id: ids.disb2, grant_out_id: ids.award1, amount_cents: 1_750_000, scheduled_date: '2026-07-01', paid_date: null, method: 'wire', status: 'scheduled', ...ts('2026-04-28') },
    ],
    grantee_reports: [
      { id: '00000000-0000-0000-0000-000000000e11', grant_out_id: ids.award1, report_type: 'progress', due_date: '2026-06-30', received_date: null, status: 'upcoming', notes: 'First quarterly progress report', ...ts('2026-04-28') },
      { id: '00000000-0000-0000-0000-000000000e12', grant_out_id: ids.award1, report_type: 'final', due_date: '2027-04-30', received_date: null, status: 'upcoming', notes: null, ...ts('2026-04-28') },
    ],
    pris: [
      { id: ids.pri1, recipient_contact_id: ids.priRecipient, instrument: 'safe', purpose: 'Reading-assessment software priced for rural schools', amount_cents: 20_000_000, investment_date: '2026-05-01', board_approval_date: null, funded_date: '2026-05-10', method: 'wire', status: 'funded', notes: null, qbo_txn_id: null, ...ts('2026-05-01') },
    ],
    pri_memos: [],
    pri_research: [],
    pri_memo_pdfs: [],
    attachments: [],
  }
}

const globalKey = Symbol.for('501c-free.demo-store')

type GlobalWithStore = typeof globalThis & { [globalKey]?: DemoStore }

/**
 * Singleton store surviving HMR / repeated imports within a server instance.
 * Reseeded after DEMO_RESET_MS, so a long-running public demo returns to the
 * sample data (and drops uploads) every few hours.
 */
export function getDemoStore(): DemoStore {
  const g = globalThis as GlobalWithStore
  const current = g[globalKey]
  if (!current || Date.now() - current.seededAt > DEMO_RESET_MS) {
    g[globalKey] = { tables: buildSeedTables(), files: new Map(), seededAt: Date.now() }
  }
  return g[globalKey]!
}
