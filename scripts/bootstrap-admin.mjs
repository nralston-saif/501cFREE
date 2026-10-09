#!/usr/bin/env node
// Adds the first admin to a fresh installation and emails them an invite.
//
//   pnpm bootstrap-admin you@your-org.org "Your Name"
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from
// .env.local. Safe to re-run: an existing team member is promoted to admin
// and reactivated (lifting the sign-in ban deactivation sets); people without a login get an invite, and people who
// already have one get a fresh password-setup link.
// After the first admin signs in, add everyone else from Settings → Team.

import { createClient } from '@supabase/supabase-js'

const [email, ...nameParts] = process.argv.slice(2)
const fullName = nameParts.join(' ').trim()

if (!email || !email.includes('@') || !fullName) {
  console.error('Usage: pnpm bootstrap-admin <email> "<full name>"')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (!url || !serviceKey) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const normalized = email.trim().toLowerCase()

const { data: existing, error: findError } = await supabase
  .from('team_members')
  .select('id, auth_user_id')
  .ilike('email', normalized)
  .maybeSingle()
if (findError) fail('Could not read team_members (have the migrations been applied?)', findError)

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
