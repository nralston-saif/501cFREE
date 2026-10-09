#!/usr/bin/env node
// Adds an admin to the team and emails them an invite link.
//
//   pnpm bootstrap-admin you@your-org.org "Your Name"
//
// For a brand-new installation, `pnpm onboard` is easier: it creates your
// login with a password, so no email link is involved. Use this script when
// you want an invite email instead, or to restore admin access for someone.
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from
// .env.local. Safe to re-run: an existing team member is promoted to admin
// and reactivated (lifting the sign-in ban deactivation sets); people without a login get an invite, and people who
// already have one get a fresh password-setup link.
// After the first admin signs in, add everyone else from Settings → Team.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { escapeLike, isPlaceholder, isValidEmail, parseEnv } from './lib/setup-helpers.mjs'

const USAGE = 'Usage: pnpm bootstrap-admin <email> "<full name>"\n  e.g. pnpm bootstrap-admin you@your-org.org "Your Name"'

const [email, ...nameParts] = process.argv.slice(2)
const fullName = nameParts.join(' ').trim()

if (!email) {
  console.error(USAGE)
  process.exit(1)
}
if (!isValidEmail(email)) {
  console.error(`"${email}" isn't an email address. The email comes first, then the name in quotes.`)
  console.error(USAGE)
  process.exit(1)
}
if (!fullName) {
  console.error(`Add the person's full name after the email.`)
  console.error(USAGE)
  process.exit(1)
}

// Load .env.local without overriding variables already set in the shell
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env.local')
if (!existsSync(envPath)) {
  console.error('No .env.local found. Run `pnpm onboard` first: it walks you through the Supabase keys.')
  process.exit(1)
}
for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) {
  if (process.env[key] === undefined) process.env[key] = value
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (isPlaceholder(url) || isPlaceholder(serviceKey)) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first (`pnpm onboard` does it for you).')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const normalized = email.trim().toLowerCase()

const { data: existing, error: findError } = await supabase
  .from('team_members')
  .select('id, auth_user_id')
  .ilike('email', escapeLike(normalized))
  .maybeSingle()
if (findError) fail('Could not read team_members (has supabase/setup.sql been run in the SQL editor?)', findError)

let authUserId = existing?.auth_user_id ?? null
if (existing) {
  const { error } = await supabase
    .from('team_members')
    .update({ role: 'admin', is_active: true, full_name: fullName })
    .eq('id', existing.id)
  if (error) fail('Could not update the existing team member', error)
  console.log(`${normalized} is now an active admin.`)
} else {
  const { error } = await supabase
    .from('team_members')
    .insert({ email: normalized, full_name: fullName, role: 'admin' })
  if (error) fail('Could not add the team member', error)
  console.log(`Added ${normalized} as an admin.`)
}

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')
const redirectTo = `${siteUrl}${basePath}/auth/callback`

if (authUserId) {
  // Deactivating a member (lib/actions/team.ts) bans their auth user; lift
  // that ban too, or the reactivated admin still can't sign in
  const { error: unbanError } = await supabase.auth.admin.updateUserById(authUserId, {
    ban_duration: 'none',
  })
  if (unbanError) fail('Could not lift the sign-in ban left by an earlier deactivation', unbanError)
}

if (authUserId) {
  // Already has a login (e.g. an earlier invite was used or expired): send a
  // password-setup link instead, which lands on the same set-password page
  const { error } = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo })
  if (error) fail('Could not send the password-setup email', error)
  console.log(`They already have a login, so a password-setup link was sent to ${normalized}.`)
} else {
  const { error } = await supabase.auth.admin.inviteUserByEmail(normalized, {
    redirectTo,
    data: { full_name: fullName },
  })
  if (error) fail('Could not send the invite email', error)
  console.log(`Invite sent to ${normalized}.`)
}
console.log(
  `Make sure the app is running at ${siteUrl}${basePath} before opening the link: ` +
    'email links work only once, and opening one while the app is down uses it up.'
)

function fail(message, error) {
  console.error(`${message}: ${error.message ?? error}`)
  process.exit(1)
}
