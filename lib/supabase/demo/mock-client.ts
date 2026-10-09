/**
 * Minimal Supabase client mock backed by the in-memory demo store.
 * Implements exactly the query-builder surface this app uses:
 *   select (incl. { count, head }) / eq / neq / in / gte / lte / gt / lt /
 *   ilike / contains / or (eq and ilike terms) / not(col,'is',null) / is /
 *   order / limit / range / single / maybeSingle / insert / update / upsert / delete,
 * plus rpc() for the database functions listed in DEMO_FUNCTIONS (results
 * support the same filters, order and range), auth.getUser/signOut and
 * storage upload/download/remove/createSignedUrl.
 *
 * Embedded resources are resolved only when they name the foreign-key
 * column with a `!hint`: `contact:contacts!contact_id(display_name)` (the
 * column is on this row: many-to-one, an object or null) or
 * `disbursements:disbursements!grant_out_id(amount_cents)` (the column is
 * on the embedded table: one-to-many, always an array; PostgREST returns an
 * object instead when that column is unique, so read such embeds with
 * oneEmbed() from lib/reports/embed.ts). Nested embeds work the same way. Embeds without a hint (`files:note_intake_files(file_name)`) are left
 * unresolved; callers treat a missing embed as null.
 */
import { getDemoStore, contactDisplayName, DEMO_AUTH_USER_ID, DEMO_USER_EMAIL } from './store'
import { withBasePath } from '@/lib/basePath'
import { DEMO_FUNCTIONS } from './functions'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string; code?: string } | null }

type Filter = (row: Row) => boolean

/**
 * Split a PostgREST or-filter into `column.op.value` terms on top-level
 * commas only: a double-quoted value may contain commas (and \" escapes).
 */
export function splitOrTerms(expression: string): string[] {
  const terms: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i]
    if (quoted && ch === '\\' && i + 1 < expression.length) {
      current += ch + expression[++i]
      continue
    }
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      terms.push(current)
      current = ''
      continue
    }
    current += ch
  }
  terms.push(current)
  return terms.filter((t) => t.length > 0)
}

/** A term's value, unquoting `"..."` (backslash escapes, as JSON.stringify writes them). */
function orTermValue(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw
  try {
    return JSON.parse(raw) as string
  } catch {
    return raw.slice(1, -1).replace(/\\(.)/g, '$1')
  }
}

/** SQL ILIKE: % and _ wildcards, backslash escapes, case-insensitive */
function ilikeMatcher(pattern: string): (value: unknown) => boolean {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) {
      source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (ch === '%') {
      source += '.*'
    } else if (ch === '_') {
      source += '.'
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  const re = new RegExp(`^${source}$`, 'is')
  return (value) => typeof value === 'string' && re.test(value)
}

/** Top-level comma split of a select string (commas inside parentheses stay). */
function splitSelect(columns: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of columns) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

type Embed = { alias: string; table: string; hint: string | null; columns: string }

/** `alias:table!hint(columns)` items of a select string */
export function parseEmbeds(columns: string): Embed[] {
  const embeds: Embed[] = []
  for (const part of splitSelect(columns)) {
    const m = /^(?:(\w+):)?(\w+)((?:!\w+)*)\((.*)\)$/s.exec(part)
    if (!m) continue
    const hints = m[3].split('!').filter((h) => h && h !== 'inner' && h !== 'left')
    embeds.push({ alias: m[1] ?? m[2], table: m[2], hint: hints[0] ?? null, columns: m[4] })
  }
  return embeds
}

/** Resolves hinted embeds on (already copied) rows, in place. */
function resolveEmbeds(rows: Row[], columns: string): Row[] {
  const embeds = parseEmbeds(columns)
  if (embeds.length === 0) return rows
  const tables = getDemoStore().tables
  for (const embed of embeds) {
    if (!embed.hint) continue
    const hint = embed.hint
    const target = tables[embed.table] ?? []
    const copy = (r: Row) => JSON.parse(JSON.stringify(r)) as Row
    for (const row of rows) {
      if (hint in row) {
        const key = row[hint]
        const match = key == null ? undefined : target.find((t) => t.id === key)
        row[embed.alias] = match ? resolveEmbeds([copy(match)], embed.columns)[0] : null
      } else {
        row[embed.alias] = resolveEmbeds(
          target.filter((t) => t[hint] === row.id).map(copy),
          embed.columns
        )
      }
    }
  }
  return rows
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : 1
}

class DemoQueryBuilder implements PromiseLike<Result> {
  private filters: Filter[] = []
  private orderings: { column: string; ascending: boolean }[] = []
  private limitCount: number | null = null
  private offset = 0
  private columns = '*'
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private onConflict: string | null = null
  private single_: 'single' | 'maybeSingle' | null = null
  private countMode = false
  private headOnly = false

  /** `source` serves rpc() results: a fixed row set instead of a table */
  constructor(
    private table: string,
    private source: Row[] | null = null,
    private failure: string | null = null
  ) {}

  private get rows(): Row[] {
    if (this.source) return this.source
    const store = getDemoStore()
    if (!store.tables[this.table]) store.tables[this.table] = []
    return store.tables[this.table]
  }

  select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    // Column projection is ignored: returning full rows is a superset of
    // any projection the app asks for. Hinted embeds are resolved.
    if (columns) this.columns = columns
    if (options?.count) this.countMode = true
    if (options?.head) this.headOnly = true
    return this
  }

  insert(payload: Row | Row[]) {
    this.mode = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Row) {
    this.mode = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.mode = 'upsert'
    this.payload = payload
    this.onConflict = options?.onConflict ?? 'id'
    return this
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value)
    return this
  }

  ilike(column: string, pattern: string) {
    const match = ilikeMatcher(pattern)
    this.filters.push((row) => match(row[column]))
    return this
  }

  contains(column: string, values: unknown[]) {
    this.filters.push((row) => {
      const cell = row[column]
      return Array.isArray(cell) && values.every((v) => cell.includes(v))
    })
    return this
  }

  /** PostgREST or-filter, e.g. `name.ilike.%a%,email.eq.x` (eq and ilike only) */
  or(expression: string) {
    const terms = splitOrTerms(expression).map((term) => {
      const [column, op, ...rest] = term.split('.')
      const value = orTermValue(rest.join('.'))
      if (op === 'ilike') {
        const match = ilikeMatcher(value)
        return (row: Row) => match(row[column])
      }
      if (op === 'eq') return (row: Row) => String(row[column]) === value
      return () => false
    })
    this.filters.push((row) => terms.some((t) => t(row)))
    return this
  }

  in(column: string, values: unknown[]) {
    const set = new Set(values)
    this.filters.push((row) => set.has(row[column]))
    return this
  }

  gte(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== null && compare(row[column], value) >= 0)
    return this
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== null && compare(row[column], value) <= 0)
    return this
  }

  gt(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== null && compare(row[column], value) > 0)
    return this
  }

  lt(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== null && compare(row[column], value) < 0)
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined)
    }
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  order(
    column: string,
    options?: { ascending?: boolean; referencedTable?: string; foreignTable?: string }
  ) {
    // Ordering inside an embed isn't emulated
    if (options?.referencedTable || options?.foreignTable) return this
    this.orderings.push({ column, ascending: options?.ascending ?? true })
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  /** Rows from..to inclusive, like PostgREST's Range header */
  range(from: number, to: number) {
    this.offset = from
    this.limitCount = Math.max(0, to - from + 1)
    return this
  }

  single() {
    this.single_ = 'single'
    return this
  }

  maybeSingle() {
    this.single_ = 'maybeSingle'
    return this
  }

  private matching(): Row[] {
    return this.rows.filter((row) => this.filters.every((f) => f(row)))
  }

  private newRow(input: Row): Row {
    const now = new Date().toISOString()
    return this.withGenerated({ id: crypto.randomUUID(), created_at: now, updated_at: now, ...input })
  }

  // Emulates generated columns that a real Postgres would compute
  private withGenerated(row: Row): Row {
    if (this.table === 'contacts') row.display_name = contactDisplayName(row)
    return row
  }

  private execute(): Result {
    if (this.failure) return { data: null, error: { message: this.failure } }
    const store = getDemoStore()

    if (this.mode === 'insert' || this.mode === 'upsert') {
      const inputs = Array.isArray(this.payload) ? this.payload : [this.payload!]
      const written: Row[] = []
      for (const input of inputs) {
        if (this.mode === 'upsert') {
          const keys = this.onConflict!.split(',').map((k) => k.trim())
          const existing = this.rows.find((row) => keys.every((k) => row[k] === input[k]))
          if (existing) {
            Object.assign(existing, input, { updated_at: new Date().toISOString() })
            this.withGenerated(existing)
            written.push(existing)
            continue
          }
        }
        const row = this.newRow(input)
        store.tables[this.table].push(row)
        written.push(row)
      }
      return this.finish(written)
    }

    if (this.mode === 'update') {
      const matched = this.matching()
      for (const row of matched) {
        Object.assign(row, this.payload, { updated_at: new Date().toISOString() })
        this.withGenerated(row)
      }
      return this.finish(matched)
    }

    if (this.mode === 'delete') {
      const matched = new Set(this.matching())
      store.tables[this.table] = this.rows.filter((row) => !matched.has(row))
      return this.finish([...matched])
    }

    // select
    let result = [...this.matching()]
    for (const { column, ascending } of [...this.orderings].reverse()) {
      result.sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]))
    }
    const total = result.length
    result = result.slice(this.offset, this.limitCount === null ? undefined : this.offset + this.limitCount)
    if (this.columns.includes('(')) {
      result = resolveEmbeds(JSON.parse(JSON.stringify(result)) as Row[], this.columns)
    }
    return this.finish(result, total)
  }

  private finish(rows: Row[], total = rows.length): Result & { count?: number } {
    if (this.countMode && this.headOnly) return { data: null, error: null, count: total }
    // Deep-copy reads so callers can't mutate the store accidentally
    const data = JSON.parse(JSON.stringify(rows)) as Row[]
    if (this.countMode && !this.single_) return { data, error: null, count: total }
    if (this.single_ === 'single') {
      if (data.length === 0) {
        return { data: null, error: { message: 'No rows found', code: 'PGRST116' } }
      }
      return { data: data[0], error: null }
    }
    if (this.single_ === 'maybeSingle') {
      return { data: data[0] ?? null, error: null }
    }
    return { data, error: null }
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    try {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected)
    }
  }
}

const demoUser = {
  id: DEMO_AUTH_USER_ID,
  email: DEMO_USER_EMAIL,
  aud: 'authenticated',
  role: 'authenticated',
}

function demoStorageBucket(bucket: string) {
  const store = getDemoStore()
  const key = (path: string) => `${bucket}/${path}`
  return {
    async upload(path: string, file: File | Buffer | Uint8Array | Blob, options?: { contentType?: string; upsert?: boolean }) {
      let bytes: Uint8Array
      let contentType = options?.contentType ?? 'application/octet-stream'
      if (file instanceof Uint8Array) {
        bytes = file
      } else {
        const blob = file as Blob
        bytes = new Uint8Array(await blob.arrayBuffer())
        if (blob.type) contentType = options?.contentType ?? blob.type
      }
      store.files.set(key(path), { bytes, contentType })
      return { data: { path }, error: null }
    },
    async download(path: string) {
      const file = store.files.get(key(path))
      if (!file) {
        return { data: null, error: { message: 'File not found (demo files reset on restart)' } }
      }
      return { data: new Blob([Buffer.from(file.bytes)], { type: file.contentType }), error: null }
    },
    async remove(paths: string[]) {
      paths.forEach((path) => store.files.delete(key(path)))
      return { data: null, error: null }
    },
    // Demo URLs never expire, so the expiresIn argument is accepted and ignored.
    async createSignedUrl(path: string) {
      if (!store.files.has(key(path))) {
        return { data: null, error: { message: 'File not found (demo files reset on restart)' } }
      }
      return {
        data: { signedUrl: withBasePath(`/api/demo-files?key=${encodeURIComponent(key(path))}`) },
        error: null,
      }
    },
  }
}

export function createDemoClient() {
  return {
    from(table: string) {
      return new DemoQueryBuilder(table)
    },
    // Only the database functions the app calls (./functions.ts). The result
    // is a query builder, so callers can filter, order and page it.
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const impl = DEMO_FUNCTIONS[fn]
      if (!impl) return new DemoQueryBuilder(`rpc:${fn}`, [], `Demo mode: function ${fn} is not available`)
      return new DemoQueryBuilder(`rpc:${fn}`, impl(getDemoStore().tables, args))
    },
    auth: {
      async getUser() {
        return { data: { user: demoUser }, error: null }
      },
      async signOut() {
        return { error: null }
      },
      async signInWithOtp() {
        return { data: {}, error: { message: 'Demo mode: authentication is disabled' } }
      },
      async exchangeCodeForSession() {
        return { data: {}, error: { message: 'Demo mode: authentication is disabled' } }
      },
      async verifyOtp() {
        return { data: {}, error: { message: 'Demo mode: authentication is disabled' } }
      },
    },
    storage: {
      from(bucket: string) {
        return demoStorageBucket(bucket)
      },
    },
  }
}

/**
 * Demo mode is the default. Going live requires BOTH an explicit
 * NEXT_PUBLIC_USE_SUPABASE=true opt-in and configured Supabase env vars -
 * integrations (e.g. Vercel's) can inject Supabase vars automatically, so
 * their mere presence must not flip the app to live mode.
 */
export function isDemoMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_USE_SUPABASE !== 'true' ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
}
