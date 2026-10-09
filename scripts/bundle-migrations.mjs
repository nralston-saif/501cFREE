#!/usr/bin/env node
// Regenerates supabase/setup.sql: every migration in supabase/migrations/,
// in filename order, as one script to paste into the Supabase SQL editor.
//
//   pnpm db:bundle
//
// Run it after changing any migration; supabase/tests/setup-sql.test.ts
// fails while setup.sql is out of date.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSetupSql } from './lib/setup-helpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const outFile = path.join(root, 'supabase', 'setup.sql')

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }))

let sql
try {
  sql = renderSetupSql(files)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

let current = null
try {
  current = readFileSync(outFile, 'utf8')
} catch {
  // first run
}

if (current === sql) {
  console.log(`supabase/setup.sql is already up to date (${files.length} migrations).`)
} else {
  writeFileSync(outFile, sql)
  console.log(`Wrote supabase/setup.sql from ${files.length} migrations.`)
}
