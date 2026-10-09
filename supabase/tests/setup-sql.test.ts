// supabase/setup.sql is the one-paste install script: every migration
// concatenated by `pnpm db:bundle`. These tests keep it in sync with the
// migrations and check it builds the same database.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createEmptyDb, createTestDb, migrationFiles } from './db'
import { renderSetupSql } from '../../scripts/lib/setup-helpers.mjs'

const SUPABASE_DIR = path.resolve(__dirname, '..')
const setupSql = () => readFileSync(path.join(SUPABASE_DIR, 'setup.sql'), 'utf8')

async function list(db: PGlite, sql: string): Promise<string[]> {
  return (await db.query<{ v: string }>(sql)).rows.map((r) => r.v)
}

// Everything the migrations create, as sorted text lists
async function snapshot(db: PGlite) {
  return {
    tables: await list(
      db,
      `select table_schema || '.' || table_name || ':' || table_type v from information_schema.tables
       where table_schema in ('public', 'storage') order by 1`
    ),
    columns: await list(
      db,
      `select table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') v
       from information_schema.columns where table_schema = 'public' order by 1`
    ),
    policies: await list(
      db,
      `select schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' ||
              coalesce(qual, '') || ':' || coalesce(with_check, '') v
       from pg_policies where schemaname in ('public', 'storage') order by 1`
    ),
    functions: await list(
      db,
      `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' v
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'storage', 'auth') order by 1`
    ),
    triggers: await list(
      db,
      `select c.relname || ':' || t.tgname v from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal order by 1`
    ),
    indexes: await list(db, `select indexdef v from pg_indexes where schemaname in ('public', 'storage') order by 1`),
    constraints: await list(
      db,
      `select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) v
       from pg_constraint where connamespace = 'public'::regnamespace order by 1`
    ),
    seeded: await list(
      db,
      `select 'expense_categories:' || count(*) v from expense_categories
       union all select 'org_settings:' || count(*) from org_settings
       union all select 'buckets:' || string_agg(id, ',' order by id) from storage.buckets`
    ),
  }
}

describe('supabase/setup.sql', () => {
  it('is up to date with supabase/migrations (run `pnpm db:bundle`)', () => {
    const files = migrationFiles().map((name) => ({
      name,
      sql: readFileSync(path.join(SUPABASE_DIR, 'migrations', name), 'utf8'),
    }))
    expect(setupSql() === renderSetupSql(files), 'supabase/setup.sql is stale: run `pnpm db:bundle`').toBe(true)
  })

  it('has nothing the Supabase SQL editor cannot run in one paste', () => {
    const sql = setupSql()
    // Bodies of functions and DO blocks are dollar-quoted; outside them there
    // must be no psql meta-commands or transaction control
    const outside = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '$$$$').replace(/--[^\n]*/g, '')
    expect(outside).not.toMatch(/^\s*\\/m)
    expect(outside).not.toMatch(/\bconcurrently\b/i)
    expect(outside).not.toMatch(/^\s*(begin|commit|rollback|savepoint|end)\s*;/im)
    // Every dollar-quote opened is closed
    expect((sql.match(/\$\$/g) ?? []).length % 2).toBe(0)
  })

  it('builds the same database as applying each migration', async () => {
    const fromMigrations = await createTestDb()
    const fromSetup = await createEmptyDb()
    // One exec = one batch, like a single SQL-editor run
    await fromSetup.exec(setupSql())

    const [a, b] = await Promise.all([snapshot(fromMigrations), snapshot(fromSetup)])
    expect(b).toEqual(a)
    expect(a.tables.length).toBeGreaterThan(30)
    expect(a.policies.length).toBeGreaterThan(30)
    expect(a.functions.length).toBeGreaterThan(20)
  }, 120_000)

  it('runs as one transaction in a single batch', async () => {
    const db = await createEmptyDb()
    // Simple-query batches are one implicit transaction: a failure at the end
    // must leave nothing behind, so a fixed re-run starts clean
    await expect(db.exec(`${setupSql()}\nselect 1/0;`)).rejects.toThrow()
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int n from information_schema.tables where table_schema = 'public'`
    )
    expect(rows[0].n).toBe(0)
  }, 120_000)
})
