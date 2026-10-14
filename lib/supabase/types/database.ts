// Database types, hand-maintained to match supabase/migrations. When you
// change a migration, update the matching row type here; supabase/tests
// applies every migration so schema mistakes surface in `pnpm test`.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ContactKind = 'person' | 'organization'
export type ContributionMethod =
  | 'check'
  | 'ach'
  | 'wire'
  | 'credit_card'
  | 'stock'
  | 'crypto'
  | 'in_kind'
/** org_settings.grant_review_mode: who votes on and advances grant proposals */
export type GrantReviewMode = 'all_members' | 'admins'

/** org_settings.public_charity_status: the organization's own IRS classification */
export type PublicCharityStatus = '509a1' | '509a2' | '509a3' | 'private_foundation'

export type ContributionVehicle =
  | 'direct'
  | 'daf'
  | 'private_foundation'
  | 'ira_qcd'
  | 'employer_match'
  | 'charitable_trust'
  | 'other'
export type Restriction = 'unrestricted' | 'donor_restricted'
export type LetterStatus = 'draft' | 'generated' | 'sent'
export type DonationInquiryStatus = 'new' | 'contacted' | 'archived'
export type GiftMethodPreference =
  | 'check'
  | 'wire_ach'
  | 'daf'
  | 'stock_crypto'
  | 'other'
export type StockValuationSource = 'manual' | 'api_estimate' | 'broker_statement'
export type FunctionalClass = 'program' | 'management_general' | 'fundraising'
export type ExpensePaymentMethod = 'card' | 'check' | 'ach' | 'wire' | 'reimbursement'
export type ContactTaxStatus =
  | '501c3_public_charity'
  | '501c3_private_foundation'
  | 'other_nonprofit'
  | 'government'
  | 'for_profit'
  | 'individual'
export type ExpenseStatus = 'pending' | 'paid' | 'reimbursed'
export type ProposalStatus =
  | 'received'
  | 'in_review'
  | 'diligence'
  | 'decided'
  | 'withdrawn'
export type ProposalDecision = 'approved' | 'declined'
export type ProposalOrigin = 'external' | 'internal'
export type DeclinedStage = 'review' | 'decision'
export type Vote = 'yes' | 'no' | 'maybe'
export type GrantOutStatus = 'awarded' | 'active' | 'completed' | 'terminated'
export type DisbursementStatus = 'scheduled' | 'paid' | 'cancelled'
export type GranteeReportType = 'progress' | 'final' | 'financial'
export type GranteeReportStatus = 'upcoming' | 'received' | 'overdue' | 'waived'
export type AttachmentEntityType =
  | 'expense'
  | 'contribution'
  | 'grant_proposal'
  | 'grant_out'
  | 'grantee_report'
  | 'contact'
  | 'governance'
  | 'pri'
export type PriInstrument = 'safe' | 'convertible_note' | 'equity' | 'loan' | 'other'
export type PriStatus =
  | 'committed'
  | 'funded'
  | 'converted'
  | 'repaid'
  | 'exited'
  | 'written_off'

export type QboEnvironment = 'sandbox' | 'production'
export type QboSyncStatus = 'not_synced' | 'synced' | 'failed'
export type QboMappingType = 'category' | 'functional_class' | 'payment_method'
export type ExpenseQboSource = 'app' | 'qbo'
export type QboInboxEntityType =
  | 'Purchase'
  | 'Deposit'
  | 'Transfer'
  | 'JournalEntry'
  | 'Bill'
  | 'BillPayment'
  | 'SalesReceipt'
export type QboInboxKind = 'new' | 'changed' | 'deleted'
export type QboInboxStatus = 'pending' | 'auto_applied' | 'approved' | 'dismissed' | 'echo'
export type QboInboxDirection = 'money_in' | 'money_out'

type TimestampedRow = {
  created_at: string
  updated_at: string
}

export type TeamMemberRole = 'admin' | 'staff'

export type TeamMember = TimestampedRow & {
  id: string
  auth_user_id: string | null
  email: string
  full_name: string
  is_active: boolean
  role: TeamMemberRole
}

export type ContactEntityType = 'nonprofit' | 'for_profit' | 'pbc' | 'government' | 'other'

/** A person or an organization. Every record that refers to "someone"
 * (donor, grantee, vendor, funder, PRI recipient, note subject, meeting
 * attendee) points at this table. */
export type Contact = TimestampedRow & {
  id: string
  kind: ContactKind
  /** Organization name, or an optional full-name override for a person */
  name: string | null
  first_name: string | null
  last_name: string | null
  /** Generated: name for organizations, "first last" (or name) for people */
  display_name: string
  is_donor: boolean
  is_grantee: boolean
  is_funder: boolean
  is_vendor: boolean
  /** A potential grantee tracked before any proposal */
  is_lead: boolean
  email: string | null
  alternative_emails: string[]
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  title: string | null
  linkedin_url: string | null
  website: string | null
  /** Organization description, or a person's short bio */
  description: string | null
  /** Logo or photo, in the documents bucket under contact-images/{id}/ */
  image_path: string | null
  twitter_url: string | null
  entity_type: ContactEntityType | null
  previous_names: string[]
  legal_name: string | null
  tax_id: string | null
  tax_status: ContactTaxStatus | null
  w9_on_file: boolean
  qbo_vendor_id: string | null
  notes: string | null
  tags: string[]
  introduced_by: string | null
  first_met_date: string | null
  how_we_met: string | null
  relationship_notes: string | null
  is_active: boolean
  created_by: string | null
}

export type AffiliationRelationship =
  | 'contact'
  | 'employee'
  | 'founder'
  | 'executive'
  | 'board_member'
  | 'advisor'
  | 'other'

export type Affiliation = TimestampedRow & {
  id: string
  person_id: string
  organization_id: string
  relationship: AffiliationRelationship
  title: string | null
  is_primary_contact: boolean
  start_date: string | null
  end_date: string | null
}

export type NoteLinkEntityType = 'contact' | 'meeting' | 'grant_proposal' | 'pri'

export type Note = TimestampedRow & {
  id: string
  content: string
  note_date: string
  author_id: string | null
}

export type NoteLink = {
  id: string
  note_id: string
  entity_type: NoteLinkEntityType
  entity_id: string
  is_primary: boolean
  created_at: string
}

export type NoteAttachment = {
  id: string
  note_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string | null
  created_at: string
}

export type NoteIntakeStatus = 'uploading' | 'processing' | 'ready' | 'filed' | 'failed'

export type NoteIntake = TimestampedRow & {
  id: string
  created_by: string
  status: NoteIntakeStatus
  proposal: Json | null
  draft: Json | null
  model: string | null
  error: string | null
  note_ids: string[]
  processing_started_at: string | null
  processed_at: string | null
  filed_at: string | null
}

export type NoteIntakeFile = {
  id: string
  intake_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export type Meeting = TimestampedRow & {
  id: string
  title: string
  meeting_date: string
  content: string | null
  created_by: string | null
}

export type MeetingAttendee = {
  id: string
  meeting_id: string
  contact_id: string
  created_by: string | null
  created_at: string
}

export type Tag = TimestampedRow & {
  id: string
  name: string
  color: string | null
  usage_count: number
  created_by: string | null
}

export type TicketStatus = 'open' | 'in_progress' | 'review' | 'closed'
export type TicketPriority = 'high' | 'medium' | 'low'

export type Ticket = TimestampedRow & {
  id: string
  title: string
  description: string | null
  status: TicketStatus
  priority: TicketPriority
  due_date: string | null
  assigned_to: string | null
  created_by: string | null
  contact_id: string | null
  tags: string[]
  is_flagged: boolean
  closed_at: string | null
}

export type TicketComment = TimestampedRow & {
  id: string
  ticket_id: string
  author_id: string
  content: string
  is_resolution: boolean
}

export type ProgramArea = TimestampedRow & {
  slug: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export type Contribution = TimestampedRow & {
  id: string
  contact_id: string
  amount_cents: number | null
  received_date: string
  method: ContributionMethod
  vehicle: ContributionVehicle
  vehicle_sponsor_name: string | null
  in_kind_description: string | null
  restriction: Restriction
  restriction_purpose: string | null
  quid_pro_quo: boolean
  goods_services_description: string | null
  goods_services_value_cents: number | null
  check_number: string | null
  notes: string | null
  entered_by: string | null
  qbo_txn_type: string | null
  qbo_txn_id: string | null
}

export type AcknowledgementLetter = TimestampedRow & {
  id: string
  contribution_id: string
  status: LetterStatus
  pdf_storage_path: string | null
  body_snapshot: Json | null
  sent_to_email: string | null
  sent_at: string | null
  resend_message_id: string | null
  generated_by: string | null
}

export type DonationInquiry = TimestampedRow & {
  id: string
  name: string
  email: string
  phone: string | null
  organization: string | null
  gift_method: GiftMethodPreference
  amount_cents: number | null
  amount_text: string | null
  message: string | null
  status: DonationInquiryStatus
  source: string
}

export type SecurityPrice = TimestampedRow & {
  id: string
  symbol: string
  price_date: string
  open_cents: number | null
  high_cents: number | null
  low_cents: number | null
  close_cents: number
  adjusted_close_cents: number | null
  volume: number | null
  source: string
  fetched_at: string | null
}

export type StockContributionDetail = TimestampedRow & {
  contribution_id: string
  security_name: string
  ticker_symbol: string | null
  cusip: string | null
  shares: number
  valuation_date: string
  fmv_per_share_cents: number | null
  fmv_total_cents: number
  valuation_source: StockValuationSource
  market_price_source: string | null
  brokerage_account: string | null
  transfer_received_date: string | null
  sale_date: string | null
  sale_gross_cents: number | null
  sale_fees_cents: number | null
  sale_net_cents: number | null
  notes: string | null
}

export type ExpenseCategory = TimestampedRow & {
  id: string
  name: string
  functional_class: FunctionalClass
  form_990_line: string | null
  /** Stable key for categories the app relies on, e.g. 'grants_paid' */
  system_key: string | null
  is_active: boolean
}

export type Expense = TimestampedRow & {
  id: string
  expense_date: string
  amount_cents: number
  description: string
  category_id: string
  vendor_contact_id: string | null
  payment_method: ExpensePaymentMethod | null
  status: ExpenseStatus
  paid_by: string | null
  is_1099_eligible: boolean
  disbursement_id: string | null
  notes: string | null
  entered_by: string | null
  qbo_purchase_id: string | null
  qbo_sync_status: QboSyncStatus
  qbo_synced_at: string | null
  qbo_sync_error: string | null
  qbo_source: ExpenseQboSource
}

export type GrantProposal = TimestampedRow & {
  id: string
  applicant_contact_id: string | null
  title: string
  summary: string | null
  /** program_areas.slug values */
  program_areas: string[]
  amount_requested_cents: number | null
  received_date: string | null
  entered_date: string
  source: string | null
  status: ProposalStatus
  origin: ProposalOrigin
  applicant_name: string | null
  applicant_email: string | null
  organization_name: string | null
  raw_submission: Json | null
  votes_revealed: boolean
  decision: ProposalDecision | null
  decision_date: string | null
  decision_notes: string | null
  declined_stage: DeclinedStage | null
  draft_response_email: string | null
  response_email_sent_at: string | null
}

export type ProposalReview = TimestampedRow & {
  id: string
  proposal_id: string
  reviewer_id: string
  score: number | null
  vote: Vote | null
  comments: string | null
  recused: boolean
}

export type ProposalComment = TimestampedRow & {
  id: string
  proposal_id: string
  author_id: string
  body: string
}

export type ProposalMemo = TimestampedRow & {
  id: string
  proposal_id: string
  q_summary_recommendation: string | null
  q_org_background: string | null
  q_cause_area_fit: string | null
  q_theory_of_change: string | null
  q_grant_size_structure: string | null
  q_counterfactual: string | null
  q_success_disappointment: string | null
  q_risks_mitigations: string | null
  q_legal_compliance: string | null
  q_monitoring_evaluation: string | null
  header_purpose: string | null
  header_structure: string | null
  header_decision: string | null
  header_grantee_descriptor: string | null
  started_by: string | null
  last_edited_by: string | null
}

export type GrantMemoPdf = TimestampedRow & {
  id: string
  proposal_id: string
  pdf_storage_path: string
  body_snapshot: Json
  generated_by: string | null
}

export type GrantResearch = TimestampedRow & {
  id: string
  proposal_id: string
  status: PriResearchStatus
  draft: Json | null
  sources: Json | null
  open_questions: Json | null
  error: string | null
  model: string | null
  requested_by: string | null
}

export type GrantOut = TimestampedRow & {
  id: string
  proposal_id: string | null
  grantee_contact_id: string
  purpose: string | null
  amount_awarded_cents: number
  award_date: string | null
  restriction: string | null
  agreement_signed_date: string | null
  status: GrantOutStatus
  notes: string | null
}

export type Disbursement = TimestampedRow & {
  id: string
  grant_out_id: string
  amount_cents: number
  scheduled_date: string | null
  paid_date: string | null
  method: 'check' | 'ach' | 'wire' | null
  status: DisbursementStatus
}

export type GranteeReport = TimestampedRow & {
  id: string
  grant_out_id: string
  report_type: GranteeReportType
  due_date: string
  received_date: string | null
  status: GranteeReportStatus
  notes: string | null
}

export type Pri = TimestampedRow & {
  id: string
  recipient_contact_id: string
  instrument: PriInstrument
  purpose: string | null
  amount_cents: number
  investment_date: string | null
  board_approval_date: string | null
  funded_date: string | null
  method: 'check' | 'ach' | 'wire' | null
  status: PriStatus
  notes: string | null
  qbo_txn_id: string | null
}

export type PriResearchStatus = 'running' | 'complete' | 'failed'

export type PriResearch = TimestampedRow & {
  id: string
  pri_id: string
  status: PriResearchStatus
  draft: Json | null
  sources: Json | null
  open_questions: Json | null
  error: string | null
  model: string | null
  requested_by: string | null
}

export type PriMemo = TimestampedRow & {
  id: string
  pri_id: string
  q_exempt_purpose: string | null
  q_why_investment: string | null
  q_income_not_significant: string | null
  q_use_of_funds: string | null
  q_key_terms: string | null
  q_success_outcomes: string | null
  q_risks: string | null
  q_exit_plan: string | null
  q_conflicts: string | null
  q_monitoring: string | null
  started_by: string | null
  last_edited_by: string | null
}

export type PriMemoPdf = TimestampedRow & {
  id: string
  pri_id: string
  attachment_id: string | null
  pdf_storage_path: string
  body_snapshot: Json
  generated_by: string | null
}

export type Attachment = TimestampedRow & {
  id: string
  entity_type: AttachmentEntityType
  entity_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string | null
}

export type OrgSettings = TimestampedRow & {
  id: number
  /** Required before letters or memoranda can be generated */
  org_legal_name: string | null
  org_display_name: string | null
  org_aliases: string[]
  ein: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string
  website_url: string | null
  mission_statement: string | null
  /** IANA time zone, e.g. 'America/Chicago' */
  timezone: string
  fiscal_year_start_month: number
  /** PRIs at or above this need a board approval date; null = never */
  pri_board_approval_threshold_cents: number | null
  /** Shown on acknowledgement letters; null = say only "501(c)(3)" */
  public_charity_status: PublicCharityStatus | null
  /** Who votes on and advances grant proposals (awards stay admin-only) */
  grant_review_mode: GrantReviewMode
  /**
   * Acknowledgement-letter wording overrides per vehicle group
   * ({ daf: { opening, tax }, ... }); absent = default. Shape and defaults:
   * lib/pdf/letter-templates.ts
   */
  letter_templates: Json
  letter_signatory_name: string | null
  letter_signatory_title: string | null
  letter_from_email: string | null
  letter_closing_text: string
}

export type QboConnection = {
  id: number
  environment: QboEnvironment
  realm_id: string
  company_name: string | null
  access_token: string
  refresh_token: string
  access_token_expires_at: string
  refresh_token_expires_at: string
  connected_by: string | null
  connected_at: string
  updated_at: string
}

export type QboMapping = TimestampedRow & {
  id: string
  mapping_type: QboMappingType
  local_key: string
  qbo_id: string
  qbo_name: string | null
}

export type QboSyncState = {
  id: number
  pull_enabled: boolean
  auto_apply_enabled: boolean
  pull_since: string
  last_cdc_at: string | null
  last_run_at: string | null
  last_run_status: 'ok' | 'error' | null
  last_run_error: string | null
  last_run_stats: Json | null
  updated_at: string
}

export type QboInboxItem = TimestampedRow & {
  id: string
  qbo_entity_type: QboInboxEntityType
  qbo_entity_id: string
  kind: QboInboxKind
  status: QboInboxStatus
  raw: Json
  previous_raw: Json | null
  txn_date: string | null
  amount_cents: number | null
  direction: QboInboxDirection | null
  counterparty_name: string | null
  qbo_payment_account_id: string | null
  qbo_line_account_ids: string[]
  qbo_doc_number: string | null
  qbo_private_note: string | null
  suggestion: Json | null
  resolution: Json | null
  dismiss_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  expense_id: string | null
  contribution_id: string | null
  disbursement_id: string | null
  pri_id: string | null
  first_seen_at: string
}

type TableDef<Row, Required extends keyof Row = never> = {
  Row: Row
  Insert: Partial<Row> & Pick<Row, Required>
  Update: Partial<Row>
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      team_members: TableDef<TeamMember, 'email' | 'full_name'>
      org_settings: TableDef<OrgSettings, never>
      program_areas: TableDef<ProgramArea, 'slug' | 'label'>
      contacts: TableDef<Contact, 'kind'>
      affiliations: TableDef<Affiliation, 'person_id' | 'organization_id'>
      notes: TableDef<Note, 'content'>
      note_links: TableDef<NoteLink, 'note_id' | 'entity_type' | 'entity_id'>
      note_attachments: TableDef<NoteAttachment, 'note_id' | 'storage_path' | 'file_name'>
      note_intakes: TableDef<NoteIntake, 'created_by'>
      note_intake_files: TableDef<NoteIntakeFile, 'intake_id' | 'storage_path' | 'file_name'>
      meetings: TableDef<Meeting, 'title' | 'meeting_date'>
      meeting_attendees: TableDef<MeetingAttendee, 'meeting_id' | 'contact_id'>
      tags: TableDef<Tag, 'name'>
      tickets: TableDef<Ticket, 'title'>
      ticket_comments: TableDef<TicketComment, 'ticket_id' | 'author_id' | 'content'>
      contributions: TableDef<Contribution, 'contact_id' | 'received_date' | 'method'>
      acknowledgement_letters: TableDef<AcknowledgementLetter, 'contribution_id'>
      donation_inquiries: TableDef<DonationInquiry, 'name' | 'email'>
      security_prices: TableDef<SecurityPrice, 'symbol' | 'price_date' | 'close_cents' | 'source'>
      stock_contribution_details: TableDef<StockContributionDetail, 'contribution_id' | 'security_name' | 'shares' | 'valuation_date' | 'fmv_total_cents'>
      expense_categories: TableDef<ExpenseCategory, 'name' | 'functional_class'>
      expenses: TableDef<Expense, 'expense_date' | 'amount_cents' | 'description' | 'category_id'>
      grant_proposals: TableDef<GrantProposal, 'title'>
      proposal_reviews: TableDef<ProposalReview, 'proposal_id' | 'reviewer_id'>
      proposal_comments: TableDef<ProposalComment, 'proposal_id' | 'author_id' | 'body'>
      proposal_memos: TableDef<ProposalMemo, 'proposal_id'>
      grant_memo_pdfs: TableDef<GrantMemoPdf, 'proposal_id' | 'pdf_storage_path' | 'body_snapshot'>
      grant_research: TableDef<GrantResearch, 'proposal_id'>
      grants_out: TableDef<GrantOut, 'grantee_contact_id' | 'amount_awarded_cents'>
      disbursements: TableDef<Disbursement, 'grant_out_id' | 'amount_cents'>
      grantee_reports: TableDef<GranteeReport, 'grant_out_id' | 'report_type' | 'due_date'>
      pris: TableDef<Pri, 'recipient_contact_id' | 'instrument' | 'amount_cents'>
      pri_memos: TableDef<PriMemo, 'pri_id'>
      pri_memo_pdfs: TableDef<PriMemoPdf, 'pri_id' | 'pdf_storage_path' | 'body_snapshot'>
      pri_research: TableDef<PriResearch, 'pri_id'>
      attachments: TableDef<Attachment, 'entity_type' | 'entity_id' | 'storage_path' | 'file_name'>
      qbo_connection: TableDef<QboConnection, 'environment' | 'realm_id' | 'access_token' | 'refresh_token' | 'access_token_expires_at' | 'refresh_token_expires_at'>
      qbo_mappings: TableDef<QboMapping, 'mapping_type' | 'local_key' | 'qbo_id'>
      qbo_sync_state: TableDef<QboSyncState, never>
      qbo_inbox: TableDef<QboInboxItem, 'qbo_entity_type' | 'qbo_entity_id' | 'raw'>
    }
    Views: Record<string, never>
    Functions: {
      is_team_member: { Args: Record<string, never>; Returns: boolean }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      current_member_id: { Args: Record<string, never>; Returns: string }
      proposal_review_progress: {
        Args: { p_proposal_ids: string[] }
        Returns: { proposal_id: string; reviewer_id: string }[]
      }
      // Summaries (0010_summaries.sql); bigint sums arrive as numbers
      fiscal_year_totals: {
        Args: { p_start: string; p_end: string }
        Returns: { contributions_cents: number; expenses_cents: number; grants_paid_cents: number }[]
      }
      contribution_summary: {
        Args: { p_start: string; p_end: string }
        Returns: { cash_cents: number; cash_count: number; stock_cents: number; stock_count: number }[]
      }
      expense_summary: {
        Args: { p_start: string; p_end: string }
        Returns: {
          total_cents: number
          program_cents: number
          management_general_cents: number
          fundraising_cents: number
          unpaid_count: number
          unpaid_cents: number
        }[]
      }
      contact_money_totals: {
        Args: { p_kind?: ContactKind | null }
        Returns: { contact_id: string; granted_cents: number; donated_cents: number; pri_cents: number }[]
      }
      contact_note_counts: {
        Args: Record<string, never>
        Returns: { contact_id: string; note_count: number }[]
      }
      proposal_memo_progress: {
        Args: { p_proposal_ids: string[] }
        Returns: { proposal_id: string; answered: number }[]
      }
    }
    Enums: {
      ticket_status: TicketStatus
      ticket_priority: TicketPriority
    }
    CompositeTypes: Record<string, never>
  }
}
