import type { QboConnection } from '@/lib/supabase/types/database'
import { qboJson } from './client'
import { query } from './api'

/**
 * Change Data Capture reads for the pull sync. CDC returns every entity of
 * the requested types changed since a timestamp — including deleted stubs
 * ({Id, status:'Deleted'}) — but only looks back 30 days. Bootstrap and
 * stale-cursor runs use paged plain queries instead (which cannot see
 * deletes; acceptable for a first fill).
 */

export type CdcEntityName = 'Purchase' | 'Deposit' | 'Transfer' | 'JournalEntry'

export const CDC_ENTITIES: readonly CdcEntityName[] = [
  'Purchase',
  'Deposit',
  'Transfer',
  'JournalEntry',
]

export type CdcRecord = {
  entityType: CdcEntityName
  entity: Record<string, unknown> & { Id: string }
  deleted: boolean
}

type CdcResponse = {
  CDCResponse?: Array<{
    QueryResponse?: Array<Record<string, unknown>>
  }>
}

export async function changedDataCapture(
  conn: QboConnection,
  entities: readonly CdcEntityName[],
  sinceISO: string
): Promise<CdcRecord[]> {
  const res = await qboJson<CdcResponse>(
    conn,
    `cdc?entities=${entities.join(',')}&changedSince=${encodeURIComponent(sinceISO)}`
  )
  const records: CdcRecord[] = []
  for (const block of res.CDCResponse ?? []) {
    for (const queryResponse of block.QueryResponse ?? []) {
      for (const entityType of entities) {
        const rows = queryResponse[entityType]
        if (!Array.isArray(rows)) continue
        for (const row of rows) {
          if (!row || typeof row.Id !== 'string') continue
          records.push({
            entityType,
            entity: row as CdcRecord['entity'],
            deleted: row.status === 'Deleted',
          })
        }
      }
    }
  }
  return records
}

const PAGE_SIZE = 100
const MAX_PAGES = 50 // safety valve; 5000 txns is far beyond this org's volume

/**
 * Paged full-entity query for bootstrap / stale cursor. `sinceISO` filters on
 * Metadata.LastUpdatedTime so edits to older transactions are still caught.
 */
export async function listChangedSince(
  conn: QboConnection,
  entityType: CdcEntityName,
  sinceISO: string
): Promise<CdcRecord[]> {
  const records: CdcRecord[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const sql = `select * from ${entityType} where Metadata.LastUpdatedTime >= '${sinceISO}' orderby Metadata.LastUpdatedTime startposition ${page * PAGE_SIZE + 1} maxresults ${PAGE_SIZE}`
    const rows = await query<CdcEntityName, Record<string, unknown> & { Id: string }>(
      conn,
      entityType,
      sql
    )
    for (const row of rows) {
      if (!row || typeof row.Id !== 'string') continue
      records.push({ entityType, entity: row, deleted: false })
    }
    if (rows.length < PAGE_SIZE) break
  }
  return records
}
