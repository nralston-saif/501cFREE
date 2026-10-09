import type { ContributionMethod, ContributionVehicle } from '@/lib/supabase/types/database'

export const METHOD_LABELS: Record<ContributionMethod, string> = {
  check: 'Check',
  ach: 'ACH',
  wire: 'Wire',
  credit_card: 'Credit card',
  stock: 'Stock',
  crypto: 'Crypto',
  in_kind: 'In-kind',
}

export const VEHICLE_LABELS: Record<ContributionVehicle, string> = {
  direct: 'Direct gift',
  daf: 'Donor-advised fund',
  private_foundation: 'Private foundation',
  ira_qcd: 'IRA qualified charitable distribution',
  employer_match: 'Employer matching gift',
  charitable_trust: 'Charitable trust',
  other: 'Other',
}

/** Short vehicle tags for table rows; 'direct' is the norm and gets no tag. */
export const VEHICLE_BADGES: Record<ContributionVehicle, string> = {
  direct: '',
  daf: 'DAF',
  private_foundation: 'Foundation',
  ira_qcd: 'IRA QCD',
  employer_match: 'Employer match',
  charitable_trust: 'Trust',
  other: 'Other vehicle',
}

/** Label for the sponsor/intermediary field, per vehicle (null = field hidden). */
export const VEHICLE_SPONSOR_LABELS: Partial<Record<ContributionVehicle, string>> = {
  daf: 'Sponsoring organization',
  private_foundation: 'Foundation name',
  ira_qcd: 'IRA custodian',
  employer_match: 'Employer',
  charitable_trust: 'Trust name',
  other: 'Vehicle details',
}

/** DAF grants and IRA QCDs may not carry donor benefits (quid pro quo). */
export function vehicleForbidsQuidProQuo(vehicle: ContributionVehicle): boolean {
  return vehicle === 'daf' || vehicle === 'ira_qcd'
}
