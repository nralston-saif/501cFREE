// Pure helpers shared by scripts/onboard.mjs, scripts/bootstrap-admin.mjs and
// scripts/bundle-migrations.mjs. No I/O here, so they're unit-tested in
// scripts/lib/setup-helpers.test.ts.

// ---------------------------------------------------------------------------
// Node version
// ---------------------------------------------------------------------------

/**
 * True when `version` (e.g. "v20.11.1") satisfies a ">=X[.Y[.Z]]" range, the
 * only form package.json's engines field uses. Other ranges pass.
 * @param {string} version
 * @param {string} range
 */
export function satisfiesMinVersion(version, range) {
  const min = /^\s*>=\s*(\d+(?:\.\d+){0,2})\s*$/.exec(range ?? '')
  if (!min) return true
  const parse = (v) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const have = parse(version)
  const want = parse(min[1])
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0
    const b = want[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

// ---------------------------------------------------------------------------
// Supabase URLs and keys
// ---------------------------------------------------------------------------

const REF = /^[a-z0-9]{10,40}$/

/**
 * Accepts a project URL (https://<ref>.supabase.co), a dashboard URL
 * (https://supabase.com/dashboard/project/<ref>/...), a bare project ref, or
 * any other http(s) URL (self-hosted or `supabase start`), and returns the
 * API URL plus the project ref when there is one. Throws with a message for
 * the user on anything else.
 * @param {string} input
 * @returns {{ url: string, ref: string | null }}
 */
export function normalizeSupabaseUrl(input) {
  const raw = (input ?? '').trim()
  if (!raw) throw new Error('Enter your Supabase project URL.')
  if (REF.test(raw)) return { url: `https://${raw}.supabase.co`, ref: raw }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error(`"${raw}" doesn't look like a URL. Paste the Project URL from Project Settings → Data API.`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`"${raw}" isn't an http(s) URL.`)
  }
  const host = parsed.hostname.toLowerCase()

  const hosted = /^([a-z0-9]+)\.supabase\.(co|in)$/.exec(host)
  if (hosted) return { url: `https://${hosted[1]}.supabase.co`, ref: hosted[1] }

  if (host === 'supabase.com' || host === 'app.supabase.com' || host.endsWith('.supabase.com')) {
    const m = /\/project\/([a-z0-9]+)/.exec(parsed.pathname)
    if (m) return { url: `https://${m[1]}.supabase.co`, ref: m[1] }
    throw new Error(
      'That dashboard link has no project in it. Open your project in the Supabase dashboard and copy the address from there.'
    )
  }

  return { url: parsed.origin, ref: null }
}

/**
 * The project ref of a hosted Supabase API URL, or null.
 * @param {string} url
 */
export function projectRef(url) {
  try {
    return normalizeSupabaseUrl(url).ref
  } catch {
    return null
  }
}

/**
 * A page of the project's Supabase dashboard, or null for self-hosted.
 * @param {string | null} ref
 * @param {string} page e.g. "sql/new", "auth/providers"
 */
export function dashboardUrl(ref, page) {
  return ref ? `https://supabase.com/dashboard/project/${ref}/${page}` : null
}

/**
 * What kind of Supabase API key this looks like.
 * @param {string} key
 * @returns {'publishable' | 'secret' | 'legacy-anon' | 'legacy-service' | 'unknown'}
 */
export function supabaseKeyKind(key) {
  const k = (key ?? '').trim()
  if (k.startsWith('sb_publishable_')) return 'publishable'
  if (k.startsWith('sb_secret_')) return 'secret'
  const parts = k.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (payload?.role === 'anon') return 'legacy-anon'
      if (payload?.role === 'service_role') return 'legacy-service'
    } catch {
      // not a JWT
    }
  }
  return 'unknown'
}

/**
 * The app's public origin: scheme + host (+ port), no trailing slash, no
 * path. Throws with a message for the user otherwise.
 * @param {string} input
 */
export function normalizeSiteUrl(input) {
  const raw = (input ?? '').trim()
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`"${raw}" isn't a full URL. Include the scheme, e.g. http://localhost:3000 or https://office.example.org`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('The site URL must start with http:// or https://')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(
      'Use just the scheme and host (e.g. https://example.org). To serve the app under a sub-path, set NEXT_PUBLIC_BASE_PATH in .env.local instead.'
    )
  }
  return parsed.origin
}

/** Leading slash, no trailing slash, or empty. @param {string | undefined} basePath */
export function normalizeBasePath(basePath) {
  const p = (basePath ?? '').trim().replace(/\/+$/, '')
  if (!p) return ''
  return p.startsWith('/') ? p : `/${p}`
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** @param {string} email */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email ?? '').trim())
}

/** Escapes LIKE/ILIKE wildcards so an email matches only itself. @param {string} value */
export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Shows enough of a secret to recognize it, never the whole thing.
 * @param {string} value
 */
export function maskSecret(value) {
  const v = value ?? ''
  if (!v) return ''
  const prefix = /^(sb_(?:publishable|secret)_)/.exec(v)?.[1] ?? ''
  const rest = v.slice(prefix.length)
  if (rest.length <= 8) return `${prefix}${'•'.repeat(4)}`
  return `${prefix}${rest.slice(0, 4)}…${rest.slice(-4)}`
}

// ---------------------------------------------------------------------------
// .env files
// ---------------------------------------------------------------------------

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

function parseValue(raw) {
  const v = raw.trim()
  const quote = v[0]
  if (quote === '"' || quote === "'" || quote === '`') {
    const end = v.indexOf(quote, 1)
    const inner = end === -1 ? v.slice(1) : v.slice(1, end)
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner
  }
  // Unquoted: a " #" starts a comment
  const hash = v.search(/\s#/)
  return (hash === -1 ? v : v.slice(0, hash)).trim()
}

/**
 * Parses a .env file into an object (later keys win). Comment lines and
 * commented-out assignments are ignored.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue
    const m = ENV_LINE.exec(line)
    if (m) out[m[1]] = parseValue(m[2])
  }
  return out
}

function formatValue(value) {
  const v = String(value ?? '')
  if (v === '' || /^[A-Za-z0-9_./:@+()=,-]*$/.test(v)) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

// Values in .env.example that only show the expected shape
const PLACEHOLDERS = [
  /^https:\/\/your-project\.supabase\.co$/,
  /^sb_(publishable|secret)_\.\.\.$/,
  /^your-[a-z0-9-]+$/,
  /\.\.\.$/,
  /^sk_your-/,
  /^re_x+$/,
]

/** True for an example placeholder (or empty) value. @param {string | undefined} value */
export function isPlaceholder(value) {
  const v = (value ?? '').trim()
  return !v || PLACEHOLDERS.some((p) => p.test(v))
}

/**
 * Renders .env.local from .env.example's text, keeping its comments and
 * layout. `values` replaces the value of each key the example sets; a
 * commented-out optional line (`# KEY=...`) is uncommented only when
 * `values` has a non-empty value for it. Keys in `values` the example
 * doesn't mention are appended at the end.
 * @param {string} exampleText
 * @param {Record<string, string | undefined>} values
 */
export function renderEnv(exampleText, values) {
  const used = new Set()
  const lines = (exampleText ?? '').split(/\r?\n/).map((line) => {
    const active = ENV_LINE.exec(line)
    if (active && !/^\s*#/.test(line)) {
      const key = active[1]
      used.add(key)
      return key in values && values[key] !== undefined ? `${key}=${formatValue(values[key])}` : line
    }
    const commented = /^\s*#\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (commented) {
      const key = commented[1]
      if (used.has(key)) return line
      const value = values[key]
      if (value !== undefined && value !== '') {
        used.add(key)
        return `${key}=${formatValue(value)}`
      }
    }
    return line
  })
  const extra = Object.entries(values).filter(
    ([key, value]) => !used.has(key) && value !== undefined && value !== ''
  )
  if (extra.length) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push('', '# Other values kept from your previous .env.local')
    for (const [key, value] of extra) lines.push(`${key}=${formatValue(value)}`)
  }
  let text = lines.join('\n')
  if (!text.endsWith('\n')) text += '\n'
  return text
}

// ---------------------------------------------------------------------------
// supabase/setup.sql
// ---------------------------------------------------------------------------

/**
 * Statements the Supabase SQL editor can't run as one batch (it runs the
 * whole paste in a single transaction), plus psql meta-commands.
 */
const NOT_ONE_PASTE = [
  [/^\s*\\/m, 'a psql meta-command (\\...)'],
  [/\bconcurrently\b/i, 'CREATE/DROP INDEX CONCURRENTLY'],
  [/^\s*(begin|commit|rollback|start\s+transaction|savepoint|end)\s*;/im, 'a transaction-control statement'],
  [/^\s*vacuum\b/im, 'VACUUM'],
  [/^\s*(create|drop)\s+database\b/im, 'CREATE/DROP DATABASE'],
  [/\balter\s+type\b[^;]*\badd\s+value\b/i, 'ALTER TYPE ... ADD VALUE'],
]

/**
 * Concatenates the migrations (already sorted by filename) into one script
 * for a single paste into the Supabase SQL editor. Throws if a migration
 * contains something that can't run that way.
 * @param {{ name: string, sql: string }[]} files
 */
export function renderSetupSql(files) {
  const rule = '-- ' + '='.repeat(74)
  const parts = [
    '-- 501(c)(FREE): complete database setup for a NEW, EMPTY Supabase project.',
    '--',
    '-- Paste this whole file into Supabase → SQL Editor → Run.',
    '-- For upgrades use the individual files in supabase/migrations/.',
    '--',
    '-- It runs as one transaction: if anything fails, nothing is applied, so fix',
    '-- the problem and run it again. Running it a second time on a database that',
    '-- already has the tables fails harmlessly with "already exists".',
    '--',
    '-- GENERATED by `pnpm db:bundle` from supabase/migrations/ (in filename',
    '-- order). Do not edit it by hand: change the migrations and re-run that.',
    '',
  ]
  for (const { name, sql } of files) {
    for (const [pattern, what] of NOT_ONE_PASTE) {
      if (pattern.test(stripSqlCommentsAndBodies(sql))) {
        throw new Error(`${name} contains ${what}, which can't run in a single SQL-editor paste.`)
      }
    }
    parts.push(rule, `-- supabase/migrations/${name}`, rule, '', sql.replace(/\s+$/, ''), '')
  }
  parts.push(rule, '-- End of setup. Next: run `pnpm onboard` in the project folder.', rule, '')
  return parts.join('\n')
}

// Removes -- comments and $$-quoted bodies (plpgsql `begin ... end;` is not
// transaction control) before the checks above
function stripSqlCommentsAndBodies(sql) {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '$$$$').replace(/--[^\n]*/g, '')
}
