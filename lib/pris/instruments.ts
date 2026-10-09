import type { PriInstrument } from '@/lib/supabase/types/database'

export const INSTRUMENT_LABELS: Record<PriInstrument, string> = {
  safe: 'SAFE',
  convertible_note: 'Convertible note',
  equity: 'Equity',
  loan: 'Loan',
  other: 'Other',
}
