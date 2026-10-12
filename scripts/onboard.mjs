#!/usr/bin/env node
// Guided first-time setup: connects the app to your Supabase project, writes
// .env.local, checks the database and sign-in settings, and creates your
// admin login (with a password, so no invite email is involved).
//
//   pnpm onboard
//
// Safe to re-run at any time: press Enter at a question to keep the current
// value. The database itself is created by pasting supabase/setup.sql into
// the Supabase SQL editor; this script tells you when.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
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
  renderEnv,
  satisfiesMinVersion,
  supabaseKeyKind,
} from './lib/setup-helpers.mjs'

const MIN_PASSWORD = 10
const ENV_FILE = '.env.local'

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = paint('1')
const dim = paint('2')
const green = paint('32')
const yellow = paint('33')
const red = paint('31')
const cyan = paint('36')

const say = (msg = '') => console.log(msg)
const ok = (msg) => say(`${green('✓')} ${msg}`)
const warn = (msg) => say(`${yellow('!')} ${msg}`)
const problem = (msg) => say(`${red('✗')} ${msg}`)
const link = (url) => cyan(url)
let stepNo = 0
const STEPS = 4
function step(title) {
  stepNo += 1
  say()
  say(bold(`Step ${stepNo} of ${STEPS}: ${title}`))
}

/** An error whose message is meant for the person running the script. */
class Friendly extends Error {}

// ---------------------------------------------------------------------------
// Preflight: Node version, repo root
// ---------------------------------------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let pkg = null
try {
  pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
} catch {
  // handled below
}
if (pkg?.name !== '501c-free' || !existsSync(path.join(root, '.env.example'))) {
  problem('Run this from the 501(c)(FREE) project folder (the one with package.json and .env.example):')
  say('  cd 501cFREE && pnpm onboard')
  process.exit(1)
}
const nodeRange = pkg.engines?.node ?? '>=20'
if (!satisfiesMinVersion(process.version, nodeRange)) {
  problem(`This needs Node.js ${nodeRange.replace('>=', '')} or newer; you have ${process.version}.`)
  say('  Install the current LTS version from https://nodejs.org and run it again.')
  process.exit(1)
}
process.chdir(root)

const { createClient } = await import('@supabase/supabase-js')

// ---------------------------------------------------------------------------
// Input (readline with an optional hidden mode for secrets)
// ---------------------------------------------------------------------------

let muted = false
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding)
    callback()
  },
})
const rl = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) })
const queued = []
const waiting = []
let inputClosed = false
rl.on('line', (line) => {
  const next = waiting.shift()
  if (next) next.resolve(line)
  else queued.push(line)
})
rl.on('close', () => {
  inputClosed = true
  while (waiting.length) waiting.shift().reject(new Error('closed'))
})
rl.on('SIGINT', () => {
  muted = false
  say()
  say('Cancelled. Run `pnpm onboard` again to pick up where you left off.')
  process.exit(130)
})

async function readLine(prompt, { hidden = false } = {}) {
  if (inputClosed) {
    // Piped input that has already ended: answer from what was buffered
    process.stdout.write(prompt)
  } else {
    rl.setPrompt(prompt)
    rl.prompt()
  }
  if (hidden && rl.terminal) muted = true
  try {
    if (queued.length) return queued.shift()
    if (inputClosed) throw new Error('closed')
    return await new Promise((resolve, reject) => waiting.push({ resolve, reject }))
  } catch {
    muted = false
    say()
    say('Input ended. Run `pnpm onboard` again to pick up where you left off.')
    process.exit(1)
  } finally {
    if (muted) {
      muted = false
      process.stdout.write('\n')
    } else if (!rl.terminal || inputClosed) {
      process.stdout.write('\n')
    }
  }
}

/**
 * Asks until `validate` accepts the answer. Enter keeps `current`.
 * `shown` is how the current value is displayed (masked for secrets).
 */
async function ask(question, { current, shown, hidden = false, trim = true, validate = (v) => v } = {}) {
  for (;;) {
    const hint = current ? dim(` [${shown ?? current}]`) : ''
    const raw = await readLine(`${question}${hint}: `, { hidden })
    const answer = trim ? raw.trim() : raw
    const value = answer === '' && current ? current : answer
    try {
      return validate(value)
    } catch (err) {
      problem(err.message)
    }
  }
}

async function confirm(question, defaultYes = true) {
  for (;;) {
    const answer = (await readLine(`${question} ${dim(defaultYes ? '[Y/n]' : '[y/N]')} `)).trim().toLowerCase()
    if (!answer) return defaultYes
    if (['y', 'yes'].includes(answer)) return true
    if (['n', 'no'].includes(answer)) return false
  }
}

/** Waits for Enter; returns what was typed (e.g. "skip"). */
async function pause(message) {
  return (await readLine(`${message} `)).trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Supabase checks
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 20_000
const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) })

function networkReason(err) {
  const code = err?.cause?.code ?? err?.code
  if (err?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'the connection timed out'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return "that address doesn't exist (check for typos)"
  if (code === 'ECONNREFUSED') return 'nothing is listening there'
  if (code && String(code).startsWith('CERT')) return 'its HTTPS certificate is not valid'
  return err?.cause?.message ?? err?.message ?? 'unknown network error'
}

/** Public auth settings; also proves the URL and publishable key work. */
async function authSettings(url, publishableKey) {
  let res
  try {
    res = await timedFetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } })
  } catch (err) {
    throw new Friendly(
      `Couldn't reach ${url}: ${networkReason(err)}. Check the project URL and your internet connection; a paused project must be restored in the dashboard first.`
    )
  }
  if (res.status === 401 || res.status === 403) {
    throw new Friendly(
      'Supabase rejected the publishable key. Copy it again from Project Settings → API Keys (it starts with sb_publishable_), and make sure it belongs to this project.'
    )
  }
  if (res.status === 404) throw new Friendly(`${url} answered, but not like a Supabase project (404). Check the project URL.`)
  if (!res.ok) throw new Friendly(`Supabase answered with HTTP ${res.status}. Is the project paused or still starting? Try again in a minute.`)
  try {
    return await res.json()
  } catch {
    throw new Friendly(`${url} answered, but not like a Supabase project. Check the project URL.`)
  }
}

function adminClient(url, secretKey) {
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: timedFetch },
  })
}

function explainAuthError(error, what) {
  const msg = error?.message ?? String(error)
  if (error?.status === 0 || /fetch failed|network|timed? ?out/i.test(msg)) {
    return `Couldn't reach Supabase while trying to ${what}: ${msg}. Check your internet connection and try again.`
  }
  if (error?.status === 401 || /invalid api key|invalid jwt|no api key/i.test(msg)) {
    return 'Supabase rejected the secret key. Copy it again from Project Settings → API Keys (it starts with sb_secret_).'
  }
  if (error?.status === 403 || /not allowed|not_admin/i.test(msg)) {
    return "That key isn't a secret key: it can't manage users. Use the secret key (sb_secret_...), not the publishable one."
  }
  return `Couldn't ${what}: ${msg}`
}

async function checkSecretKey(admin) {
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) throw new Friendly(explainAuthError(error, 'check the secret key'))
}

const MISSING_RELATION = (error) =>
  error && (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? ''))

/** 'ready' | 'missing' | 'partial' */
async function schemaState(admin) {
  const team = await admin.from('team_members').select('id').limit(1)
  if (MISSING_RELATION(team.error)) return 'missing'
  if (team.error) throw new Friendly(dbError(team.error, 'read team_members'))
  // 0004 creates expense_categories and 0091 fills it: a quick check that
  // every migration ran, not just the first
  const categories = await admin.from('expense_categories').select('id').limit(1)
  if (MISSING_RELATION(categories.error)) return 'partial'
  if (categories.error) throw new Friendly(dbError(categories.error, 'read expense_categories'))
  return categories.data?.length ? 'ready' : 'partial'
}

function dbError(error, what) {
  const msg = error?.message ?? String(error)
  if (/fetch failed|network|timed? ?out|abort/i.test(msg)) return `Couldn't reach the database to ${what}: ${msg}. Try again.`
  if (/invalid api key|jwt/i.test(msg)) return 'Supabase rejected the secret key. Copy it again from Project Settings → API Keys.'
  return `Couldn't ${what}: ${msg}`
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

say(bold('501(c)(FREE) setup'))
say('This connects the app to your Supabase project, saves the settings in .env.local,')
say('checks your database and sign-in settings, and creates your admin login.')
say(dim('Re-run it any time. Press Ctrl+C to stop.'))

// --- Step 1: keys --------------------------------------------------------

step('Connect your Supabase project')

const envPath = path.join(root, ENV_FILE)
const existingText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null
const existing = existingText ? parseEnv(existingText) : {}
const keep = (key) => (isPlaceholder(existing[key]) ? undefined : existing[key])
if (existingText) say(`Found an existing ${ENV_FILE}. Press Enter at any question to keep its current value.`)
else say(`In the Supabase dashboard, open your project. You can paste the address from your browser's address bar.`)

let url
let ref
let publishableKey
let settings
let current = { url: keep('NEXT_PUBLIC_SUPABASE_URL'), pub: keep('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') }
for (;;) {
  ;({ url, ref } = await ask('Supabase project URL (or dashboard address, or project ref)', {
    current: current.url,
    validate: normalizeSupabaseUrl,
  }))
  if (!current.pub) {
    say(dim(`  Keys are under Project Settings → API Keys${ref ? `: ${dashboardUrl(ref, 'settings/api-keys')}` : ''}`))
  }
  publishableKey = await ask('Publishable key (sb_publishable_...)', {
    current: current.pub,
    validate: (v) => {
      const kind = supabaseKeyKind(v)
      if (!v) throw new Error('Paste the publishable key.')
      if (kind === 'secret' || kind === 'legacy-service') {
        throw new Error('That is a SECRET key. It must never be public. Paste the publishable key (sb_publishable_...) here.')
      }
      if (kind === 'legacy-anon') warn('That looks like a legacy anon key. It works, but the publishable key (sb_publishable_...) is recommended.')
      else if (kind === 'unknown') warn("That doesn't look like a Supabase publishable key (sb_publishable_...). Trying it anyway.")
      return v
    },
  })
  try {
    settings = await authSettings(url, publishableKey)
    ok(`Connected to ${url}`)
    break
  } catch (err) {
    if (!(err instanceof Friendly)) throw err
    problem(err.message)
    current = { url, pub: publishableKey }
  }
}

let secretKey
let admin
let currentSecret = keep('SUPABASE_SECRET_KEY')
for (;;) {
  secretKey = await ask('Secret key (sb_secret_..., hidden as you type)', {
    current: currentSecret,
    shown: maskSecret(currentSecret ?? ''),
    hidden: true,
    validate: (v) => {
      const kind = supabaseKeyKind(v)
      if (!v) throw new Error('Paste the secret key.')
      if (kind === 'publishable' || kind === 'legacy-anon') {
        throw new Error("That's the publishable key. Paste the secret key (sb_secret_...) from the same page.")
      }
      if (kind === 'legacy-service') warn('That looks like a legacy service_role key. It works, but the secret key (sb_secret_...) is recommended.')
      else if (kind === 'unknown') warn("That doesn't look like a Supabase secret key (sb_secret_...). Trying it anyway.")
      return v
    },
  })
  admin = adminClient(url, secretKey)
  try {
    await checkSecretKey(admin)
    ok(`Secret key works (${maskSecret(secretKey)})`)
    break
  } catch (err) {
    if (!(err instanceof Friendly)) throw err
    problem(err.message)
    currentSecret = undefined
  }
}

const siteUrl = await ask('Site URL (where you open the app)', {
  current: keep('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000',
  validate: normalizeSiteUrl,
})
const basePath = normalizeBasePath(existing.NEXT_PUBLIC_BASE_PATH)
const appUrl = `${siteUrl}${basePath}`

const cronSecret = keep('CRON_SECRET') ?? randomBytes(32).toString('hex')
const exampleText = readFileSync(path.join(root, '.env.example'), 'utf8')
const envText = renderEnv(exampleText, {
  ...existing,
  NEXT_PUBLIC_USE_SUPABASE: 'true',
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  NEXT_PUBLIC_SITE_URL: siteUrl,
  CRON_SECRET: cronSecret,
})
if (envText !== existingText) {
  if (existingText) {
    writeFileSync(path.join(root, '.env.backup.local'), existingText, { mode: 0o600 })
    say(dim('  Your previous file is saved as .env.backup.local'))
  }
  writeFileSync(envPath, envText, { mode: 0o600 })
  ok(`Saved ${ENV_FILE}${keep('CRON_SECRET') ? '' : ' (with a new random CRON_SECRET)'}`)
} else {
  ok(`${ENV_FILE} is up to date`)
}

// --- Step 2: database ----------------------------------------------------

step('Database')
for (;;) {
  let state
  try {
    state = await schemaState(admin)
  } catch (err) {
    if (!(err instanceof Friendly)) throw err
    problem(err.message)
    await pause('Press Enter to try again.')
    continue
  }
  if (state === 'ready') {
    ok('Database tables are in place')
    break
  }
  const sqlEditor = dashboardUrl(ref, 'sql/new') ?? 'the SQL editor of your Supabase project'
  if (state === 'missing') {
    say("Your database isn't set up yet:")
    say(`  1. Open ${link(sqlEditor)}`)
    say('  2. Paste the whole of supabase/setup.sql (open it in any text editor, select all, copy)')
    say('  3. Click Run, and wait for "Success"')
  } else {
    warn('Your database is only partly set up: some migrations are missing.')
    say('  If this is a new project with nothing else in it, the simplest fix is a new, empty project')
    say('  with supabase/setup.sql pasted in. Otherwise run the missing files from supabase/migrations/,')
    say(`  in filename order, in ${link(sqlEditor)}`)
  }
  await pause('Then press Enter here.')
}

// --- Step 3: auth settings -----------------------------------------------

step('Sign-in settings')
for (;;) {
  if (settings?.external && settings.external.email === false) {
    warn('The Email sign-in provider is turned off; the app signs people in with email and password.')
    say(`  Turn on Email at ${link(dashboardUrl(ref, 'auth/providers') ?? 'Authentication → Sign In / Providers')}`)
  }
  if (settings?.disable_signup) {
    ok('Public sign-ups are off')
    break
  }
  warn('Public sign-ups are ON.')
  say('  Only people on your team list should be able to get a login. The database already')
  say('  rejects anyone else, but turn sign-ups off too so strangers cannot even try:')
  say(`  open ${link(dashboardUrl(ref, 'auth/providers') ?? 'Authentication → Sign In / Providers')}`)
  say('  and turn OFF "Allow new users to sign up", then click Save.')
  const answer = await pause('Press Enter when done (or type "skip"):')
  if (answer === 'skip') {
    warn('Skipped. Turn sign-ups off before you go live.')
    break
  }
  try {
    settings = await authSettings(url, publishableKey)
  } catch (err) {
    if (!(err instanceof Friendly)) throw err
    problem(err.message)
  }
  if (!settings?.disable_signup) say(dim('  Still on. The change can take a few seconds to apply.'))
}

say()
say('Now the sign-in redirect addresses (this one cannot be checked automatically):')
say(`  open ${link(dashboardUrl(ref, 'auth/url-configuration') ?? 'Authentication → URL Configuration')}`)
say(`  - Site URL: ${bold(appUrl)}`)
say(`  - Redirect URLs: add ${bold(`${appUrl}/auth/callback`)}`)
if (!siteUrl.startsWith('http://localhost')) say(`    (and http://localhost:3000${basePath}/auth/callback if you also run it locally)`)
say(dim('  Password-reset and invite links only work for addresses on that list.'))
await pause('Press Enter when done.')

// --- Step 4: first admin -------------------------------------------------

step('Your admin login')

const fullName = await ask('Your full name', {
  validate: (v) => {
    if (!v) throw new Error('Enter your name.')
    return v
  },
})
const email = await ask('Your email (you sign in with it)', {
  validate: (v) => {
    if (!isValidEmail(v)) throw new Error(`"${v}" isn't an email address.`)
    return v.toLowerCase()
  },
})

async function askPassword() {
  for (;;) {
    const first = await ask(`Choose a password (at least ${MIN_PASSWORD} characters, hidden)`, {
      hidden: true,
      trim: false,
      validate: (v) => {
        if (v.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`)
        return v
      },
    })
    const second = await ask('Type it again', { hidden: true, trim: false })
    if (first === second) return first
    problem("The two passwords don't match. Try again.")
  }
}

// The team row comes first: the database only lets listed emails have a login
const found = await admin
  .from('team_members')
  .select('id, email, auth_user_id')
  .ilike('email', escapeLike(email))
  .limit(5)
if (found.error) fail(dbError(found.error, 'read the team list'))
let member = found.data.find((m) => m.email.toLowerCase() === email) ?? null

if (member) {
  const { error } = await admin
    .from('team_members')
    .update({ role: 'admin', is_active: true, full_name: fullName })
    .eq('id', member.id)
  if (error) fail(dbError(error, 'update your team entry'))
  ok(`${email} is on the team as an active admin`)
} else {
  const { data, error } = await admin
    .from('team_members')
    .insert({ email, full_name: fullName, role: 'admin', is_active: true })
    .select('id, email, auth_user_id')
    .single()
  if (error) fail(dbError(error, 'add you to the team'))
  member = data
  ok(`Added ${email} to the team as an admin`)
}

let userId = member.auth_user_id
let manualLink = false
if (userId) {
  say(`${email} already has a login.`)
  const reset = await confirm('Set a new password for it?', false)
  const password = reset ? await askPassword() : undefined
  await updateLogin(userId, password)
} else {
  for (;;) {
    const password = await askPassword()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (!error) {
      userId = data.user.id
      ok('Created your login')
      break
    }
    if (error.code === 'weak_password' || /password/i.test(error.message)) {
      problem(`Supabase didn't accept that password: ${error.message}`)
      continue
    }
    if (error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) {
      // A login exists but isn't linked to the team row (e.g. an earlier
      // sign-up, or the row was removed and re-added). generateLink returns
      // the user without sending any email.
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      if (linkError || !linkData?.user?.id) fail(explainAuthError(linkError, 'look up your existing login'))
      userId = linkData.user.id
      say(`${email} already had a login; setting this password on it.`)
      await updateLogin(userId, password, { confirm: true })
      manualLink = true
      break
    }
    if (/database error/i.test(error.message)) {
      fail(
        'Supabase Auth could not create the login because the database refused it. Usually that means ' +
          `the email isn't on the team list ("Email ... is not on the team"). Check that ${email} is in ` +
          'the team_members table, and see Logs → Auth in the dashboard for the exact reason.'
      )
    }
    fail(explainAuthError(error, 'create your login'))
  }
}

async function updateLogin(id, password, { confirm: confirmEmail = false } = {}) {
  // Deactivating a member bans their login (lib/actions/team.ts); lift it,
  // as scripts/bootstrap-admin.mjs does
  const { error } = await admin.auth.admin.updateUserById(id, {
    ban_duration: 'none',
    ...(password ? { password } : {}),
    ...(confirmEmail ? { email_confirm: true } : {}),
  })
  if (error) fail(explainAuthError(error, 'update your login'))
  ok(password ? 'Password updated (and any sign-in ban lifted)' : 'Login kept as it is (any sign-in ban lifted)')
}

// The database links a confirmed login to the team row by email
let linked = await linkedUserId(member.id)
if (linked !== userId && manualLink && !linked) {
  const { error } = await admin.from('team_members').update({ auth_user_id: userId }).eq('id', member.id)
  if (error) fail(dbError(error, 'link your login to your team entry'))
  linked = await linkedUserId(member.id)
}
if (linked === userId) {
  ok('Your login is linked to your team entry')
} else {
  problem("Your login exists but isn't linked to your team entry, so signing in would show \"access denied\".")
  say('  The link is made by the database trigger on auth.users (on_auth_user_created, from')
  say('  supabase/setup.sql). Check it exists under Database → Triggers (schema auth), then run')
  say('  `pnpm onboard` again.')
  if (linked) say(`  (The team entry for ${email} is linked to a different login: ${linked}.)`)
  process.exit(1)
}

async function linkedUserId(memberId) {
  const { data, error } = await admin.from('team_members').select('auth_user_id').eq('id', memberId).single()
  if (error) fail(dbError(error, 'check your team entry'))
  return data.auth_user_id
}

// --- Done ----------------------------------------------------------------

rl.close()
say()
say(bold(green(`Done. Run \`pnpm dev\`, open ${appUrl}, sign in as ${email}.`)))
say('Next: Settings → Organization (legal name, EIN, address, mission). Invite everyone else')
say('from Settings → Team; they get an email link to choose their own password.')
say(dim("Don't add people with Supabase's own Invite user button: logins only work for people on the team list."))
if (!/^http:\/\/localhost/.test(siteUrl)) {
  say(dim('Deploying? Add the same values from .env.local to your host. See docs/setup.md.'))
}
say(
  dim(
    "Tip: Supabase's built-in email is rate-limited (a few emails an hour). Set up custom SMTP under Authentication → Emails before inviting your team."
  )
)
process.exit(0)

function fail(message) {
  problem(message)
  process.exit(1)
}
