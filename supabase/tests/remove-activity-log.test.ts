// 0100 removes the v0.1.0 activity log (audit_log, its trigger functions and
// every audit trigger). Checked on a fresh install (all migrations) and as an
// upgrade of a v0.1.0 database that already recorded events.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addMember, asService, asUser, createEmptyDb, createTestDb, migrationFiles } from './db'

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations')
const REMOVAL = '0100_remove_activity_log.sql'

async function leftovers(db: PGlite) {
  await asService(db)
  const q = async (sql: string) => (await db.query<{ v: string }>(sql)).rows.map((r) => r.v)
  return {
    tables: await q(`select table_schema || '.' || table_name v from information_schema.tables where table_name = 'audit_log'`),
    triggers: await q(
      `select c.relname || '.' || t.tgname v from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and t.tgname in ('audit_write', 'audit_session_login', 'audit_session_logout')`
    ),
    functions: await q(`select proname v from pg_proc where proname in ('log_record_write', 'log_session_event')`),
  }
}

const NONE = { tables: [], triggers: [], functions: [] }

describe('activity log removal (0100)', () => {
  it('leaves no audit_log table, audit triggers or audit functions after all migrations', async () => {
    const db = await createTestDb()
    expect(await leftovers(db)).toEqual(NONE)

    // Writes and sign-ins still work without the triggers
    const admin = await addMember(db, 'admin@example.org', 'admin')
    await asService(db)
    await db.query(`insert into auth.sessions (user_id) values ($1)`, [admin.userId])
    await asUser(db, admin.userId)
    await db.query(`insert into contacts (kind, name) values ('organization', 'Example Org')`)
    await asService(db)
    await db.query(`delete from auth.sessions where user_id = $1`, [admin.userId])
  }, 60_000)

  it('removes the log from an existing v0.1.0 database, and is safe to run twice', async () => {
    const db = await createEmptyDb()
    const removal = readFileSync(path.join(MIGRATIONS_DIR, REMOVAL), 'utf8')
    // The v0.1.0 baseline: everything before 0100
    for (const file of migrationFiles().filter((f) => f < '0100')) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    }
    const admin = await addMember(db, 'admin@example.org', 'admin')
    await asService(db)
    await db.query(`insert into auth.sessions (user_id) values ($1)`, [admin.userId])
    await asUser(db, admin.userId)
    await db.query(`insert into contacts (kind, name) values ('organization', 'Example Org')`)
    await asService(db)
    expect((await db.query(`select * from audit_log`)).rows.length).toBeGreaterThan(0)
    expect((await leftovers(db)).triggers.length).toBeGreaterThan(30)

    await db.exec(removal)
    expect(await leftovers(db)).toEqual(NONE)
    await db.exec(removal)
    expect(await leftovers(db)).toEqual(NONE)

    // Other cross-cutting triggers from 0090 are untouched
    const kept = await db.query<{ n: number }>(
      `select count(*)::int n from pg_trigger where tgname = 'set_updated_at' and not tgisinternal`
    )
    expect(kept.rows[0].n).toBeGreaterThan(10)
  }, 60_000)
})
