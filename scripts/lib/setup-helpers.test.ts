import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dashboardUrl,
  escapeLike,
  isPlaceholder,
  isValidEmail,
  maskSecret,
  normalizeBasePath,
  normalizeSiteUrl,
  normalizeSupabaseUrl,
  parseEnv,
  projectRef,
  renderEnv,
  renderSetupSql,
  satisfiesMinVersion,
  supabaseKeyKind,
} from './setup-helpers.mjs'

const example = readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8')

describe('satisfiesMinVersion', () => {
  it('compares against a >= range', () => {
    expect(satisfiesMinVersion('v20.11.0', '>=20.11')).toBe(true)
    expect(satisfiesMinVersion('v22.1.0', '>=20.11')).toBe(true)
    expect(satisfiesMinVersion('v20.10.9', '>=20.11')).toBe(false)
    expect(satisfiesMinVersion('v18.19.0', '>=20')).toBe(false)
    expect(satisfiesMinVersion('v18.0.0', '^18')).toBe(true)
  })
})

describe('normalizeSupabaseUrl', () => {
  const ref = 'abcdefghijklmnopqrst'
  const expected = { url: `https://${ref}.supabase.co`, ref }

  it('accepts the project URL, a bare host, a ref or a dashboard URL', () => {
    expect(normalizeSupabaseUrl(`https://${ref}.supabase.co`)).toEqual(expected)
    expect(normalizeSupabaseUrl(` https://${ref}.supabase.co/rest/v1/ `)).toEqual(expected)
    expect(normalizeSupabaseUrl(`${ref}.supabase.co`)).toEqual(expected)
    expect(normalizeSupabaseUrl(ref)).toEqual(expected)
    expect(normalizeSupabaseUrl(`https://supabase.com/dashboard/project/${ref}`)).toEqual(expected)
    expect(normalizeSupabaseUrl(`https://supabase.com/dashboard/project/${ref}/settings/api-keys`)).toEqual(expected)
  })

  it('keeps other URLs (self-hosted, local CLI) as their origin', () => {
    expect(normalizeSupabaseUrl('http://127.0.0.1:54321/')).toEqual({ url: 'http://127.0.0.1:54321', ref: null })
    expect(normalizeSupabaseUrl('https://db.example.org')).toEqual({ url: 'https://db.example.org', ref: null })
  })

  it('rejects input that is not a project', () => {
    expect(() => normalizeSupabaseUrl('')).toThrow(/Enter/)
    expect(() => normalizeSupabaseUrl('https://supabase.com/dashboard/projects')).toThrow(/no project/)
    expect(() => normalizeSupabaseUrl('ftp://x.supabase.co')).toThrow(/http/)
    expect(() => normalizeSupabaseUrl('not a url')).toThrow(/doesn't look like a URL/)
  })

  it('extracts refs and builds dashboard links', () => {
    expect(projectRef(`https://${ref}.supabase.co`)).toBe(ref)
    expect(projectRef('http://localhost:54321')).toBeNull()
    expect(dashboardUrl(ref, 'sql/new')).toBe(`https://supabase.com/dashboard/project/${ref}/sql/new`)
    expect(dashboardUrl(null, 'sql/new')).toBeNull()
  })
})

describe('supabaseKeyKind', () => {
  const jwt = (role: string) =>
    ['e30', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'sig'].join('.')

  it('tells the key types apart', () => {
    expect(supabaseKeyKind('sb_publishable_abc')).toBe('publishable')
    expect(supabaseKeyKind('sb_secret_abc')).toBe('secret')
    expect(supabaseKeyKind(jwt('anon'))).toBe('legacy-anon')
    expect(supabaseKeyKind(jwt('service_role'))).toBe('legacy-service')
    expect(supabaseKeyKind('hello')).toBe('unknown')
  })
})

describe('site URL and base path', () => {
  it('normalizes to an origin', () => {
    expect(normalizeSiteUrl('http://localhost:3000/')).toBe('http://localhost:3000')
    expect(normalizeSiteUrl('https://office.example.org')).toBe('https://office.example.org')
    expect(() => normalizeSiteUrl('office.example.org')).toThrow(/full URL/)
    expect(() => normalizeSiteUrl('https://example.org/office')).toThrow(/NEXT_PUBLIC_BASE_PATH/)
  })

  it('normalizes the base path', () => {
    expect(normalizeBasePath('')).toBe('')
    expect(normalizeBasePath(undefined)).toBe('')
    expect(normalizeBasePath('office/')).toBe('/office')
    expect(normalizeBasePath('/office')).toBe('/office')
  })
})

describe('people', () => {
  it('validates emails', () => {
    expect(isValidEmail('you@your-org.org')).toBe(true)
    expect(isValidEmail(' you@your-org.org ')).toBe(true)
    expect(isValidEmail('Your Name')).toBe(false)
    expect(isValidEmail('you@localhost')).toBe(false)
    expect(isValidEmail('a b@example.org')).toBe(false)
  })

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('first_last@example.org')).toBe('first\\_last@example.org')
    expect(escapeLike('100%@example.org')).toBe('100\\%@example.org')
  })

  it('masks secrets', () => {
    expect(maskSecret('sb_secret_abcdefghijklmnop')).toBe('sb_secret_abcd…mnop')
    expect(maskSecret('sb_secret_abc')).toBe('sb_secret_••••')
    expect(maskSecret('0123456789abcdef')).toBe('0123…cdef')
    expect(maskSecret('')).toBe('')
  })
})

describe('env files', () => {
  it('parses assignments, quotes and comments', () => {
    expect(
      parseEnv(
        [
          '# comment',
          'A=1',
          'export B="two words"',
          "C='x # not a comment'",
          'D=value # trailing comment',
          '# E=commented',
          'F=',
          'G=501(c)(FREE)',
        ].join('\n')
      )
    ).toEqual({ A: '1', B: 'two words', C: 'x # not a comment', D: 'value', F: '', G: '501(c)(FREE)' })
  })

  it('recognizes .env.example placeholders', () => {
    const values = parseEnv(example)
    expect(isPlaceholder(values.NEXT_PUBLIC_SUPABASE_URL)).toBe(true)
    expect(isPlaceholder(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)).toBe(true)
    expect(isPlaceholder(values.SUPABASE_SECRET_KEY)).toBe(true)
    expect(isPlaceholder(values.CRON_SECRET)).toBe(true)
    expect(isPlaceholder('sb_secret_realvalue123')).toBe(false)
    expect(isPlaceholder('https://abc.supabase.co')).toBe(false)
  })

  it('renders .env.local from .env.example, keeping its comments', () => {
    const out = renderEnv(example, {
      NEXT_PUBLIC_USE_SUPABASE: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      SUPABASE_SECRET_KEY: 'sb_secret_y',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      CRON_SECRET: 'f00d',
    })
    const parsed = parseEnv(out)
    expect(parsed).toMatchObject({
      NEXT_PUBLIC_USE_SUPABASE: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_y',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      CRON_SECRET: 'f00d',
      NEXT_PUBLIC_APP_NAME: '501(c)(FREE)',
    })
    // Optional integrations stay commented out
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined()
    expect(out).toContain('# ANTHROPIC_API_KEY=sk-ant-...')
    // Comments survive, and the line count only changes by what was set
    expect(out).toContain('# Off (or unset) = open-access DEMO MODE')
    expect(out.split('\n').length).toBe(example.replace(/\n?$/, '\n').split('\n').length)
  })

  it('keeps optional and extra values from an earlier .env.local', () => {
    const out = renderEnv(example, {
      ANTHROPIC_API_KEY: 'sk-ant-real',
      NEXT_PUBLIC_APP_NAME: 'Our Office',
      MY_EXTRA: 'kept',
    })
    const parsed = parseEnv(out)
    expect(parsed.ANTHROPIC_API_KEY).toBe('sk-ant-real')
    expect(parsed.NEXT_PUBLIC_APP_NAME).toBe('Our Office')
    expect(out).toContain('NEXT_PUBLIC_APP_NAME="Our Office"')
    expect(parsed.MY_EXTRA).toBe('kept')
    expect(out).toMatch(/# Other values kept from your previous \.env\.local\nMY_EXTRA=kept\n$/)
    // Untouched optional lines are still commented
    expect(parsed.RESEND_API_KEY).toBeUndefined()
  })
})

describe('renderSetupSql', () => {
  it('concatenates files with headers', () => {
    const sql = renderSetupSql([
      { name: '0001_a.sql', sql: 'create table a (id int);\n' },
      { name: '0002_b.sql', sql: "create function f() returns void language plpgsql as $$ begin end; $$;\n" },
    ])
    expect(sql).toMatch(/^-- 501\(c\)\(FREE\): complete database setup/)
    expect(sql).toContain('Paste this whole file into Supabase → SQL Editor → Run.')
    expect(sql.indexOf('-- supabase/migrations/0001_a.sql')).toBeLessThan(
      sql.indexOf('-- supabase/migrations/0002_b.sql')
    )
    expect(sql).toContain('$$ begin end; $$')
  })

  it('refuses statements a single SQL-editor paste cannot run', () => {
    const bad = (sql: string) => () => renderSetupSql([{ name: 'x.sql', sql }])
    expect(bad('\\i other.sql')).toThrow(/meta-command/)
    expect(bad('create index concurrently i on t (a);')).toThrow(/CONCURRENTLY/)
    expect(bad('begin;\ncreate table t ();\ncommit;')).toThrow(/transaction-control/)
    expect(bad("alter type s add value 'x';")).toThrow(/ADD VALUE/)
    // A comment mentioning them is fine
    expect(bad('-- never use create index concurrently here\nselect 1;')).not.toThrow()
  })
})
