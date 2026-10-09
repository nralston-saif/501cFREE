// Test helper: a fresh embedded Postgres (PGlite) with the Supabase shim and
// every migration applied, plus helpers to act as a signed-in team member.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations')

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } })
  await db.exec(readFileSync(path.resolve(__dirname, 'supabase-shim.sql'), 'utf8'))
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    }
  }
  return db
}

export type Member = { memberId: string; userId: string }

// Adds a team member and accepts an admin invite for them (the auth trigger
// links invited or confirmed users to their team row)
export async function addMember(
  db: PGlite,
  email: string,
  role: 'admin' | 'staff'
): Promise<Member> {
  await asService(db)
  const member = await db.query<{ id: string }>(
    `insert into team_members (email, full_name, role) values ($1, $1, $2) returning id`,
    [email, role]
  )
  const user = await db.query<{ id: string }>(
    `insert into auth.users (email, invited_at) values ($1, now()) returning id`,
    [email]
  )
  return { memberId: member.rows[0].id, userId: user.rows[0].id }
}

export async function asService(db: PGlite): Promise<void> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`)
}

export async function asUser(db: PGlite, userId: string | null): Promise<void> {
  await db.exec(`reset role;`)
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : '',
  ])
  await db.exec(userId ? `set role authenticated;` : `set role anon;`)
}
