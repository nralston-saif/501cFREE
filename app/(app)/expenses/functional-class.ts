import type { FunctionalClass } from '@/lib/supabase/types/database'

export const FUNCTIONAL_CLASS_ORDER: FunctionalClass[] = [
  'program',
  'management_general',
  'fundraising',
]

export const FUNCTIONAL_CLASS_LABELS: Record<FunctionalClass, string> = {
  program: 'Program',
  management_general: 'Management & general',
  fundraising: 'Fundraising',
}

export const FUNCTIONAL_CLASS_BADGES: Record<FunctionalClass, string> = {
  program: 'bg-green-100 text-green-800',
  management_general: 'bg-blue-100 text-blue-800',
  fundraising: 'bg-purple-100 text-purple-800',
}
