import type {
  Contact,
  OrgSettings,
  Pri,
  PriMemo,
  PriStatus,
} from '@/lib/supabase/types/database'
import { PRI_MEMO_FIELDS } from '@/lib/pris/memo'
import { INSTRUMENT_LABELS } from '@/lib/pris/instruments'
import { formatCents } from '@/lib/utils/money'
import { formatDateLong } from '@/lib/utils/dates'
import {
  contactLines,
  formatTaxStatusLine,
  granteeLines,
  requireLegalName,
  type MemoData,
  type PrincipalContact,
} from './memo-data'

/**
 * Builds the frozen data snapshot a Mission-Alignment Memorandum PDF is
 * rendered from — the PRI counterpart to buildMemoData. Same layout as the
 * grant memorandum: header key/value table from record data, ten numbered
 * sections straight from the memo's Q&A.
 */

const EMPTY = '—'

const STATUS_LINES: Record<PriStatus, string> = {
  committed: 'Committed — not yet funded',
  funded: 'Funded',
  converted: 'Converted',
  repaid: 'Repaid',
  exited: 'Exited',
  written_off: 'Written off',
}

function keyDateLines(pri: Pri): string[] {
  const lines: string[] = []
  if (pri.board_approval_date) {
    lines.push(`Board approved ${formatDateLong(pri.board_approval_date)}`)
  }
  if (pri.investment_date) {
    lines.push(`Investment dated ${formatDateLong(pri.investment_date)}`)
  }
  if (pri.funded_date) {
    const method =
      pri.method === 'wire' ? ' (wire)' : pri.method === 'ach' ? ' (ACH)' : pri.method === 'check' ? ' (check)' : ''
    lines.push(`Funded${method} ${formatDateLong(pri.funded_date)}`)
  }
  return lines.length > 0 ? lines : [EMPTY]
}

export function buildPriMemoData(
  pri: Pri,
  memo: PriMemo,
  recipient: Contact,
  principal: PrincipalContact | null,
  settings: OrgSettings,
  generatedDate: string
): MemoData {
  const orgLegalName = requireLegalName(settings)
  const headerRows: MemoData['headerRows'] = [
    { label: 'Recipient', lines: granteeLines(recipient, null) },
    { label: 'Principal contact', lines: contactLines(recipient, principal) },
    { label: 'Tax status', lines: [formatTaxStatusLine(recipient)] },
    { label: 'Instrument', lines: [INSTRUMENT_LABELS[pri.instrument]] },
    { label: 'Amount', lines: [formatCents(pri.amount_cents)] },
    { label: 'Purpose', lines: [pri.purpose?.trim() || EMPTY] },
    { label: 'Key dates', lines: keyDateLines(pri) },
    { label: 'Status', lines: [STATUS_LINES[pri.status]] },
  ]

  const sections: MemoData['sections'] = PRI_MEMO_FIELDS.map(([key, prompt], index) => ({
    number: index + 1,
    heading: prompt,
    body: (memo[key] ?? '').trim() || '(Not completed)',
  }))

  return {
    title: 'Mission-Alignment Memorandum',
    orgLegalName,
    subtitle: `${orgLegalName} - Program-Related Investment Record`,
    generatedDate: formatDateLong(generatedDate),
    granteeName: recipient.legal_name?.trim() || recipient.display_name,
    headerRows,
    sections,
  }
}
