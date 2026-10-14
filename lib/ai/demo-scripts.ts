// Pre-written AI samples for demo mode: deterministic, realistic output for
// every AI feature, so a public demo works with no Anthropic key. Pure
// functions of their input (the same input always gives the same output).
// Client-safe: only pure modules and types are imported (no SDK, database,
// Node or Next.js code; demo-scripts.test.ts checks the import graph), because
// the demo panels call these in the browser from data the page already has
// (see lib/ai/demo.ts for why nothing runs on the server).
//
// Everything here is invented sample content: example.org sources, invented
// vendors and people. Callers label the result with DEMO_AI_LABEL.

import { MEMO_HEADER_FIELDS, MEMO_SECTION_FIELDS, type MemoSectionKey } from '@/lib/grants/memo'
import { PRI_MEMO_FIELDS, type PriMemoKey } from '@/lib/pris/memo'
import { parseInvoiceResult, type ExtractedInvoice } from '@/lib/invoices/normalize'
import type { DeclinedStage } from '@/lib/supabase/types/database'
import type { NoteIntakeProposal, ProposedNote } from '@/lib/note-intake-core/proposal'
import { DEMO_AI_LABEL } from './demo-label'

export { DEMO_AI_LABEL }

/** FNV-1a: a small stable hash, so outputs vary with the input but never at random */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length]
}

/** YYYY-MM-DD plus (or minus) whole days, in UTC */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function monthLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'organization'
  )
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Shared organization facts the research and drafting scripts use */
export type DemoOrg = {
  name: string
  mission: string | null
  programAreas: { label: string }[]
}

/** Just the organization facts the scripts use (e.g. from an AiOrgContext), safe to pass to a client component */
export function toDemoOrg(org: DemoOrg): DemoOrg {
  return { name: org.name, mission: org.mission, programAreas: org.programAreas.map((a) => ({ label: a.label })) }
}

/** "50,000" for 5,000,000 cents; the research prompts' wording for a missing amount */
export function demoAmountDollars(cents: number | null): string {
  return cents != null ? (cents / 100).toLocaleString('en-US') : 'not specified'
}

function focusPhrase(org: DemoOrg): string {
  const areas = org.programAreas.map((a) => a.label.toLowerCase())
  return areas.length > 0 ? listPhrase(areas) : 'our current grantmaking focus'
}

// ---------------------------------------------------------------------------
// Invoice reading (bulk upload)
// ---------------------------------------------------------------------------

type InvoiceTemplate = {
  match: RegExp
  category: string
  vendor: string
  otherNames: string[]
  vendorType: 'organization' | 'individual'
  description: string
  baseCents: number
  documentType: 'invoice' | 'receipt'
  likely1099: boolean
  monthly: boolean
}

const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  {
    match: /account|bookkeep|audit|990|tax|cpa/,
    category: 'Accounting fees',
    vendor: 'Ledger & Co. Accounting LLP',
    otherNames: ['Ledger & Co.'],
    vendorType: 'organization',
    description: 'Monthly bookkeeping and payroll filings',
    baseCents: 85_000,
    documentType: 'invoice',
    likely1099: true,
    monthly: true,
  },
  {
    match: /software|saas|subscri|licen|cloud|hosting|domain/,
    category: 'Software & IT',
    vendor: 'Northwind Cloud Software Inc.',
    otherNames: ['Northwind Cloud'],
    vendorType: 'organization',
    description: 'Donor database subscription (annual plan)',
    baseCents: 54_000,
    documentType: 'receipt',
    likely1099: false,
    monthly: false,
  },
  {
    match: /legal|law|attorney|counsel/,
    category: 'Legal fees',
    vendor: 'Harbor Street Legal LLP',
    otherNames: [],
    vendorType: 'organization',
    description: 'Review of grant agreement template',
    baseCents: 97_500,
    documentType: 'invoice',
    likely1099: true,
    monthly: false,
  },
  {
    match: /hotel|lodg|travel|mileage|flight|airfare|taxi|trip|inn/,
    category: 'Travel',
    vendor: 'Prairie Inn & Suites',
    otherNames: [],
    vendorType: 'organization',
    description: 'Lodging for grantee site visit (2 nights)',
    baseCents: 31_800,
    documentType: 'receipt',
    likely1099: false,
    monthly: false,
  },
  {
    match: /insur|premium|policy|liability/,
    category: 'Insurance',
    vendor: 'Example Mutual Insurance Co.',
    otherNames: ['Example Mutual'],
    vendorType: 'organization',
    description: 'Directors and officers liability premium',
    baseCents: 142_000,
    documentType: 'invoice',
    likely1099: false,
    monthly: false,
  },
  {
    match: /cater|event|gala|dinner|venue|banquet/,
    category: 'Fundraising events',
    vendor: 'Riverside Catering Co.',
    otherNames: [],
    vendorType: 'organization',
    description: 'Catering for donor appreciation evening',
    baseCents: 268_000,
    documentType: 'invoice',
    likely1099: false,
    monthly: false,
  },
  {
    match: /design|consult|contract|freelanc|photo/,
    category: 'Software & IT',
    vendor: 'Jamie Ortiz Design',
    otherNames: ['Jamie Ortiz'],
    vendorType: 'individual',
    description: 'Annual report layout and print files',
    baseCents: 120_000,
    documentType: 'invoice',
    likely1099: true,
    monthly: false,
  },
]

/**
 * A plausible invoice for any uploaded file: the file name picks the kind
 * of bill (keywords like "legal" or "hotel", otherwise a hash), and varies
 * the amount and dates. `today` is the organization's today (YYYY-MM-DD).
 * The category is one of `categoryNames` (or null if none fits).
 */
export function scriptedInvoiceExtraction(
  fileName: string,
  categoryNames: string[],
  today: string
): ExtractedInvoice {
  const name = fileName.toLowerCase()
  const seed = stableHash(name)
  const template = INVOICE_TEMPLATES.find((t) => t.match.test(name)) ?? pick(INVOICE_TEMPLATES, seed)
  const category = categoryNames.includes(template.category)
    ? template.category
    : categoryNames.length > 0
      ? pick(categoryNames, seed)
      : 'unknown'
  // Up to about +/- 15% around the template amount, in whole dollars and cents
  const variation = ((seed >>> 8) % 3_000) - 1_500
  const amountCents = Math.max(1_000, template.baseCents + Math.round((template.baseCents * variation) / 10_000))
  const issued = addDays(today, -(3 + ((seed >>> 4) % 25)))
  const receipt = template.documentType === 'receipt'
  const raw = {
    found: true,
    document_type: template.documentType,
    vendor_name: template.vendor,
    vendor_other_names: template.otherNames,
    vendor_type: template.vendorType,
    total_amount: (amountCents / 100).toFixed(2),
    invoice_date: issued,
    invoice_date_basis: 'stated',
    payment_date: receipt ? issued : null,
    due_date: receipt ? null : addDays(issued, 30),
    service_period: template.monthly ? monthLabel(issued) : null,
    date_note: null,
    description: template.description,
    category,
    likely_1099: template.likely1099,
  }
  return parseInvoiceResult(raw)
}

// ---------------------------------------------------------------------------
// Grant research memo
// ---------------------------------------------------------------------------

export type DemoGrantResearchInput = {
  applicantName: string
  title: string
  summary: string | null
  programAreaLabels: string[]
  amountDollars: string
  org: DemoOrg
}

export type DemoResearchDraft<K extends string> = {
  answers: Record<K, string>
  sources: { url: string; title: string }[]
  open_questions: string[]
}

function demoSources(applicantName: string): { url: string; title: string }[] {
  const base = `https://example.org/sample-sources/${slug(applicantName)}`
  return [
    { url: `${base}/about`, title: `${applicantName}: About us and leadership (sample source)` },
    { url: `${base}/annual-report`, title: `${applicantName}: Most recent annual report (sample source)` },
    { url: `${base}/news/program-update`, title: `Local news coverage of ${applicantName}'s programs (sample source)` },
  ]
}

/** Draft text for all ten Grant Memorandum sections, header suggestions, sources and open questions */
export function scriptedGrantResearch(input: DemoGrantResearchInput): DemoResearchDraft<MemoSectionKey> & {
  header: { header_purpose: string; header_structure: string; header_grantee_descriptor: string }
} {
  const { applicantName: who, title, org } = input
  const areas = input.programAreaLabels.length > 0 ? listPhrase(input.programAreaLabels.map((a) => a.toLowerCase())) : focusPhrase(org)
  const amount = `$${input.amountDollars}`
  const summary = input.summary?.trim() || `the work described in "${title}"`

  const text: Record<MemoSectionKey, string> = {
    q_summary_recommendation: `${who} requests ${amount} for "${title}". The project fits ${org.name}'s work in ${areas}, the team has a credible delivery record for a program of this size, and the budget is proportionate to the planned outputs. Recommendation: approve [TO CONFIRM], paid in two installments with the second tied to a progress report.`,
    q_org_background: `${who} is a community-based nonprofit with a small paid staff and a volunteer base. Its public materials describe several years of running programs in the same region, a board of local educators and business leaders, and funding from a mix of individual donors and small foundations. Tax-exempt status should be verified against the IRS Tax Exempt Organization Search before award [TO CONFIRM].`,
    q_cause_area_fit: `The proposal sits squarely in ${areas}. ${org.mission ? `It advances the stated mission ("${org.mission.slice(0, 140)}${org.mission.length > 140 ? '…' : ''}") by reaching children and families who have little other access to this kind of program.` : 'No mission statement is recorded, so fit is judged against the program areas only [TO CONFIRM].'}`,
    q_theory_of_change: `In brief: ${summary}. Regular, structured contact with trained adults and age-appropriate books increases reading time and confidence; sustained over a school year, this is associated with measurable gains in early reading assessments. The plan names the activities, the people delivering them and the outputs it will track.`,
    q_grant_size_structure: `Amount justification: ${amount} covers program staff time, materials and modest evaluation costs; no indirect-cost line exceeds 15%.\n\nStructure: a gift agreement with two installments, 60% on signing and 40% after an interim report [TO CONFIRM].`,
    q_counterfactual: `Without this grant the applicant says it would run a smaller version of the project, reaching roughly half as many participants. Other funders named in its materials give general support at lower amounts, so this grant would be among its larger single gifts this year [TO CONFIRM].`,
    q_success_disappointment: `Success: the planned number of participants complete the program, attendance stays above 75%, and pre/post reading checks show improvement for most participants.\n\nDisappointment: enrollment well below plan, or no usable outcome data at the end of the grant period.`,
    q_risks_mitigations: `Key risks are staff turnover in a small team, lower-than-planned enrollment, and the grant becoming a large share of the applicant's budget. Mitigations: installment funding, a named backup program lead, and an interim check-in at the halfway point.`,
    q_legal_compliance: `Confirm public charity status (IRS determination letter or Tax Exempt Organization Search), check the state charity registry, and confirm that no officer or board member of ${org.name} has a relationship with ${who} [TO CONFIRM]. No lobbying or political activity is proposed.`,
    q_monitoring_evaluation: `An interim report at six months (enrollment, attendance, spending to date) and a final report with outcome data and a short narrative. One site visit or video call during the grant period.`,
  }
  const answers = Object.fromEntries(MEMO_SECTION_FIELDS.map(([key]) => [key, text[key]])) as Record<MemoSectionKey, string>

  const openQuestions = [
    `Confirm ${who}'s current tax-exempt status and legal name for the gift agreement.`,
    'Ask for the most recent financial statements to check the grant against total annual budget.',
    `Agree the outcome measures and the reporting dates with ${who} before the agreement is signed.`,
  ]
  if (!org.mission) openQuestions.push('Record your organization’s mission statement in Settings so research can judge mission fit.')

  return {
    answers,
    header: {
      header_grantee_descriptor: 'a nonprofit public benefit corporation [TO CONFIRM]',
      header_purpose: `Support of "${title}"`,
      header_structure: `Gift agreement; ${amount} in two installments (60% on signing, 40% after the interim report) [TO CONFIRM]`,
    },
    sources: demoSources(who),
    open_questions: openQuestions,
  }
}

/** A research draft laid out for reading: what the demo panels render inline */
export type DemoResearchReport = {
  /** Suggested header rows (grant memorandum only) */
  header?: { label: string; value: string }[]
  /** Every memo question, in print order, with its drafted answer */
  sections: { label: string; answer: string }[]
  sources: { url: string; title: string }[]
  open_questions: string[]
}

/** The grant research sample as the demo panel shows it */
export function grantResearchReport(input: DemoGrantResearchInput): DemoResearchReport {
  const draft = scriptedGrantResearch(input)
  return {
    header: MEMO_HEADER_FIELDS.flatMap(([key, label]) => {
      const value = (draft.header as Record<string, string | undefined>)[key]
      return value ? [{ label, value }] : []
    }),
    sections: MEMO_SECTION_FIELDS.map(([key, label]) => ({ label, answer: draft.answers[key] })),
    sources: draft.sources,
    open_questions: draft.open_questions,
  }
}

// ---------------------------------------------------------------------------
// PRI research memo
// ---------------------------------------------------------------------------

export type DemoPriResearchInput = {
  recipientName: string
  instrumentLabel: string
  amountDollars: string
  purpose: string | null
  org: DemoOrg
}

/** Draft answers to the ten PRI mission-alignment questions, sources and open questions */
export function scriptedPriResearch(input: DemoPriResearchInput): DemoResearchDraft<PriMemoKey> {
  const { recipientName: who, instrumentLabel: instrument, org } = input
  const amount = `$${input.amountDollars}`
  const purpose = input.purpose?.trim() || 'its charitable program work'

  const text: Record<PriMemoKey, string> = {
    q_exempt_purpose: `The investment furthers ${org.name}'s exempt purposes in ${focusPhrase(org)} by financing ${purpose}. The product's main users are schools and families the organization already serves through grants.`,
    q_why_investment: `${who} expects revenue from its customers over time, so repayable or convertible capital fits better than a grant: the funds can come back and be recycled into charitable use. A grant of the same size would be spent once.`,
    q_income_not_significant: `The terms are concessionary for a company at this stage [TO CONFIRM]: a commercial investor would ask for a lower valuation cap or more rights for comparable risk. The investment was sought because of the charitable outcome, not the expected return.`,
    q_use_of_funds: `Product development and pilot deployments in under-resourced schools, plus the support staff those pilots need. Use of funds should be restricted to that purpose in a side letter [TO CONFIRM].`,
    q_key_terms: `${instrument}, ${amount}. Confirm the valuation cap, discount, maturity or conversion events, information rights and any charitable-use covenant from the executed instrument [TO CONFIRM].`,
    q_success_outcomes: `More schools using low-cost reading tools, with evidence that teachers use the data to target instruction and that students' reading scores improve.`,
    q_risks: `Early-stage company risk: the investment could lose all of its principal. There is also mission-drift risk if the company moves upmarket. Mitigations: charitable-use covenant, annual reporting, and the right to redirect proceeds.`,
    q_exit_plan: `On conversion, repayment or sale, proceeds return to ${org.name} and are used for charitable purposes (new grants or further PRIs), as the board resolution should state [TO CONFIRM].`,
    q_conflicts: `No board member, staff member or affiliated fund relationship with ${who} is recorded in this database. Confirm with the board and record any disclosures in the minutes [TO CONFIRM].`,
    q_monitoring: `Annual report on use of funds and charitable outcomes (schools served, usage, pricing), plus financial statements. A yearly check-in call, and a review if the company changes its pricing or target market.`,
  }
  const answers = Object.fromEntries(PRI_MEMO_FIELDS.map(([key]) => [key, text[key]])) as Record<PriMemoKey, string>

  const openQuestions = [
    'Attach the executed instrument so the key terms can be checked against it.',
    `Confirm ${who}'s current pricing for schools and how it will stay affordable.`,
    'Record the board approval date if the amount is above the board-approval threshold.',
  ]
  if (!org.mission) openQuestions.push('Record your organization’s mission statement in Settings so research can judge mission fit.')

  return { answers, sources: demoSources(who), open_questions: openQuestions }
}

/** The PRI research sample as the demo panel shows it */
export function priResearchReport(input: DemoPriResearchInput): DemoResearchReport {
  const draft = scriptedPriResearch(input)
  return {
    sections: PRI_MEMO_FIELDS.map(([key, label]) => ({ label, answer: draft.answers[key] })),
    sources: draft.sources,
    open_questions: draft.open_questions,
  }
}

// ---------------------------------------------------------------------------
// Decline email
// ---------------------------------------------------------------------------

export type DemoDeclineInput = {
  applicantName: string
  organizationName: string | null
  title: string
  declinedStage: DeclinedStage
}

/** First name for the greeting, or the whole name when the applicant is an organization */
function greetingName(applicantName: string, organizationName: string | null): string {
  if (organizationName && applicantName === organizationName) return `${applicantName} team`
  const first = applicantName.trim().split(/\s+/)[0]
  return first || 'there'
}

/** A polite decline draft: Subject line, blank line, body */
export function scriptedDeclineEmail(input: DemoDeclineInput, org: DemoOrg): string {
  const greeting = greetingName(input.applicantName, input.organizationName)
  const onBehalf =
    input.organizationName && input.organizationName !== input.applicantName ? ` on behalf of ${input.organizationName}` : ''
  const stage =
    input.declinedStage === 'review'
      ? 'After an initial review, we have decided not to move this proposal forward.'
      : 'After careful review by our team, we have decided not to fund this proposal.'
  const reason =
    org.programAreas.length > 0
      ? `Our grants currently focus on ${focusPhrase(org)}, and this request falls outside that focus.`
      : 'It falls outside our current grantmaking focus.'
  const wishes = input.organizationName ? `you and everyone at ${input.organizationName}` : 'you'

  return `Subject: Your proposal to ${org.name}: ${input.title}

Dear ${greeting},

Thank you for sending us "${input.title}"${onBehalf}. We appreciate the thought and care that went into it, and the energy you bring to this work.

${stage} ${reason}

We wish ${wishes} every success with the project.

Warmly,
The ${org.name} Team`
}

// ---------------------------------------------------------------------------
// Notes inbox
// ---------------------------------------------------------------------------

export type DemoContact = { id: string; kind: 'person' | 'organization'; name: string }
export type DemoRecord = { id: string; type: 'grant_proposal' | 'pri'; label: string }

/**
 * A proposal of two or three notes for the dropped files, linked to existing
 * contacts (and a grant proposal or PRI when there is one), with one
 * suggested new contact on the first note. `contacts` are candidates the
 * uploader can see; links carry their real ids and names.
 */
export function scriptedNoteIntake(
  fileNames: string[],
  contacts: DemoContact[],
  records: DemoRecord[],
  today: string
): NoteIntakeProposal {
  const seed = stableHash(fileNames.join('|'))
  const orgs = contacts.filter((c) => c.kind === 'organization')
  const people = contacts.filter((c) => c.kind === 'person')
  const org1 = orgs.length ? pick(orgs, seed) : null
  const org2 = orgs.length > 1 ? orgs[(orgs.indexOf(org1!) + 1 + ((seed >>> 3) % (orgs.length - 1))) % orgs.length] : null
  const person1 = people.length ? pick(people, seed >>> 5) : null
  const record = records.length ? pick(records, seed >>> 7) : null
  const noteCount = fileNames.length >= 3 ? 3 : 2
  const filesFor = (i: number) => {
    const own = fileNames.map((_, idx) => idx).filter((idx) => idx % noteCount === i)
    return own.length ? own : fileNames.length ? [0] : []
  }
  const source = fileNames[0] ?? 'the uploaded notes'

  const contactLink = (c: DemoContact, confidence: 'high' | 'medium', evidence: string) => ({
    entity_type: 'contact' as const,
    entity_id: c.id,
    label: c.name,
    contact_kind: c.kind,
    confidence,
    evidence,
  })

  const firstWith = org1?.name ?? 'a partner organization'
  const note1: ProposedNote = {
    title: `Check-in call with ${firstWith}`,
    meeting_date: addDays(today, -2),
    summary: `Quarterly check-in with ${firstWith}${person1 ? ` (${person1.name} joined)` : ''}. Enrollment is ahead of plan and the team wants to add two more sites next year. They asked about timing for a renewal request.`,
    key_points: [
      'Enrollment is about 15% ahead of the plan for this point in the year.',
      'Volunteer tutor retention improved after the new training schedule.',
      'Two additional rural sites are interested for next year.',
    ],
    follow_ups: [
      'Send the renewal timeline and reporting template (owner: program team).',
      'Schedule a site visit for next month.',
    ],
    transcript: `Notes from ${source}.\n\nCheck-in with ${firstWith}. Enrollment ahead of plan (~15%). Tutor retention better since the training schedule changed. Want to expand to 2 more sites next year; asked when a renewal request should come in. Next: send renewal timeline + reporting template; set up a site visit next month.`,
    file_indexes: filesFor(0),
    links: [
      ...(org1 ? [contactLink(org1, 'high', `"Check-in with ${org1.name}"`)] : []),
      ...(person1 ? [contactLink(person1, 'medium', `${person1.name} is named as joining the call`)] : []),
    ],
    new_contacts: [
      {
        kind: 'person',
        name: 'Taylor Brooks',
        email: 'taylor.brooks@example.org',
        organization: org1?.name ?? null,
        role_at_organization: org1 ? 'employee' : null,
        title: 'Program Coordinator',
        suggested_role: 'contact',
        evidence: '"Taylor Brooks (program coordinator) will send the attendance data"',
      },
    ],
  }

  const secondWith = org2?.name ?? 'a funder'
  const note2: ProposedNote = {
    title: record ? `Diligence discussion: ${record.label}` : `Introductory meeting with ${secondWith}`,
    meeting_date: addDays(today, -5),
    summary: record
      ? `Team discussion of ${record.label}. Most open questions are answered; the remaining item is a current budget. A decision could be ready for the next review meeting.`
      : `First meeting with ${secondWith} to compare grantmaking priorities and explore co-funding a family reading program.`,
    key_points: record
      ? ['Letters of support received from two partners.', 'A current budget and board list are still outstanding.']
      : ['Shared interest in family engagement programs.', 'They fund on a spring and fall cycle.'],
    follow_ups: record
      ? ['Request the updated budget and board list.']
      : [`Share last year's grantee list with ${secondWith}.`],
    transcript: record
      ? `Discussed ${record.label}. Two letters of support in. Still need current budget + board list. Could decide at next review meeting.`
      : `Intro with ${secondWith}. Overlap on family engagement. Spring/fall cycles. Send them our grantee list.`,
    file_indexes: filesFor(1),
    links: [
      ...(record
        ? [{ entity_type: record.type, entity_id: record.id, label: record.label, confidence: 'high' as const, evidence: `Notes name ${record.label}` }]
        : []),
      ...(org2 ? [contactLink(org2, record ? 'medium' : 'high', `"${org2.name}" appears in the notes`)] : []),
    ],
    new_contacts: [],
  }

  const notes = [note1, note2]
  if (noteCount === 3) {
    notes.push({
      title: 'Team planning notes',
      meeting_date: addDays(today, -1),
      summary: 'Internal planning: next quarter’s site visits and the grant report calendar.',
      key_points: ['Site visits split across two weeks next month.', 'Three grantee reports are due this quarter.'],
      follow_ups: ['Put the report due dates on the shared calendar.'],
      transcript: 'Planning: site visits over two weeks next month. 3 grantee reports due this quarter, add to calendar.',
      file_indexes: filesFor(2),
      links: org1 ? [contactLink(org1, 'medium', `Site visit to ${org1.name} planned`)] : [],
      new_contacts: [],
    })
  }

  return {
    notes,
    warnings: fileNames.length > 1 ? [] : ['A few words in the margin were hard to read and were left out.'],
  }
}
