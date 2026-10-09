'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isValidTimeZone } from '@/lib/utils/dates'
import { parseDollarsToCents } from '@/lib/utils/money'
import { isPublicCharityStatus } from '@/lib/utils/tax-status'
import {
  buildLetterTemplateOverrides,
  LETTER_TEMPLATE_GROUPS,
  type LetterTemplate,
  type LetterTemplateGroup,
} from '@/lib/pdf/letter-templates'
import type { Json } from '@/lib/supabase/types/database'
import { PROGRAM_AREA_SLUG_PATTERN, slugifyProgramArea } from '@/lib/program-areas'
import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_STORAGE_PATH,
  SIGNATURE_TYPES,
} from '@/lib/letters/signature'
import { requireAdminId, requiredString, optionalString, ActionError, actionErrorMessage } from './helpers'

export type SettingsActionState = { error: string | null; ok: boolean }

/**
 * Run an action and return its outcome instead of throwing: a thrown
 * ActionError surfaces as the generic error page in production, so the
 * settings UI renders the message inline instead.
 */
async function asState(run: () => Promise<void>): Promise<SettingsActionState> {
  try {
    await run()
    return { error: null, ok: true }
  } catch (err) {
    return {
      error: actionErrorMessage(err, 'Saving failed unexpectedly. Check the server logs.'),
      ok: false,
    }
  }
}

const DEFAULT_CLOSING_TEXT = 'Thank you for your generous support of our mission.'

/** "Acme Fdn, Acme Foundation\nACME" → ['Acme Fdn', 'Acme Foundation', 'ACME'] */
function parseAliases(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[\n,]/)) {
    const alias = part.trim().slice(0, 200)
    if (alias && !seen.has(alias.toLowerCase())) {
      seen.add(alias.toLowerCase())
      out.push(alias)
    }
  }
  return out.slice(0, 20)
}

function parseWebsite(raw: string | null): string | null {
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new ActionError('Website must be a valid URL')
  }
}

async function updateSettings(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()

  const fiscalYearStartMonth = Number(optionalString(formData, 'fiscal_year_start_month') ?? '1')
  if (
    !Number.isInteger(fiscalYearStartMonth) ||
    fiscalYearStartMonth < 1 ||
    fiscalYearStartMonth > 12
  ) {
    throw new ActionError('Fiscal year start month must be 1-12')
  }

  const timezone = requiredString(formData, 'timezone')
  if (!isValidTimeZone(timezone)) {
    throw new ActionError(`Unknown time zone "${timezone}" (use an IANA name like America/Chicago)`)
  }

  const country = (optionalString(formData, 'country') ?? 'US').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ActionError('Country must be a two-letter code, e.g. US')
  }

  // Blank = no board-approval requirement for PRIs
  const thresholdRaw = optionalString(formData, 'pri_board_approval_threshold')
  let priThresholdCents: number | null = null
  if (thresholdRaw) {
    priThresholdCents = parseDollarsToCents(thresholdRaw)
    if (priThresholdCents == null || priThresholdCents < 0) {
      throw new ActionError(
        'PRI board-approval threshold must be a dollar amount, or blank for none'
      )
    }
  }

  const charityStatusRaw = optionalString(formData, 'public_charity_status')
  if (charityStatusRaw !== null && !isPublicCharityStatus(charityStatusRaw)) {
    throw new ActionError('Unknown public charity status')
  }

  const grantReviewMode = optionalString(formData, 'grant_review_mode') ?? 'all_members'
  if (grantReviewMode !== 'all_members' && grantReviewMode !== 'admins') {
    throw new ActionError('Unknown grant review setting')
  }

  const { error } = await supabase
    .from('org_settings')
    .update({
      org_legal_name: requiredString(formData, 'org_legal_name'),
      org_display_name: optionalString(formData, 'org_display_name'),
      org_aliases: parseAliases(optionalString(formData, 'org_aliases')),
      ein: optionalString(formData, 'ein'),
      address_line1: optionalString(formData, 'address_line1'),
      address_line2: optionalString(formData, 'address_line2'),
      city: optionalString(formData, 'city'),
      state: optionalString(formData, 'state'),
      postal_code: optionalString(formData, 'postal_code'),
      country,
      website_url: parseWebsite(optionalString(formData, 'website_url')),
      mission_statement: optionalString(formData, 'mission_statement'),
      timezone,
      fiscal_year_start_month: fiscalYearStartMonth,
      pri_board_approval_threshold_cents: priThresholdCents,
      public_charity_status: charityStatusRaw,
      grant_review_mode: grantReviewMode,
      letter_signatory_name: optionalString(formData, 'letter_signatory_name'),
      letter_signatory_title: optionalString(formData, 'letter_signatory_title'),
      letter_from_email: optionalString(formData, 'letter_from_email'),
      letter_closing_text: optionalString(formData, 'letter_closing_text') ?? DEFAULT_CLOSING_TEXT,
    })
    .eq('id', 1)

  if (error) throw new ActionError(error.message)

  // Org name, timezone and policy show up across the app
  revalidatePath('/', 'layout')
}

/** useActionState-compatible: saves the organization settings form */
export async function updateSettingsAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  return asState(() => updateSettings(formData))
}

// ---------------------------------------------------------------------------
// Program areas (admin-only; RLS enforces the same)

async function slugInUse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slug: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('grant_proposals')
    .select('id', { count: 'exact', head: true })
    .contains('program_areas', [slug])
  if (error) throw new ActionError(error.message)
  return (count ?? 0) > 0
}

export async function createProgramArea(formData: FormData): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const label = requiredString(formData, 'label').slice(0, 100)
    const slug = optionalString(formData, 'slug') ?? slugifyProgramArea(label)
    if (!PROGRAM_AREA_SLUG_PATTERN.test(slug)) {
      throw new ActionError('Slug must be lowercase letters, digits, - or _')
    }

    const { data: last } = await supabase
      .from('program_areas')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('program_areas').insert({
      slug,
      label,
      description: optionalString(formData, 'description'),
      sort_order: (last?.sort_order ?? 0) + 10,
    })
    if (error) {
      throw new ActionError(
        error.code === '23505' ? `A program area with slug "${slug}" already exists` : error.message
      )
    }
    revalidatePath('/', 'layout')
  })
}

/**
 * Rename (label/description) and, while no proposal uses it yet, change the
 * slug. Once a record is tagged with a slug it is permanent, because records
 * store the slug itself.
 */
export async function updateProgramArea(formData: FormData): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const slug = requiredString(formData, 'slug')
    const newSlug = optionalString(formData, 'new_slug') ?? slug
    const update: { label: string; description: string | null; slug?: string } = {
      label: requiredString(formData, 'label').slice(0, 100),
      description: optionalString(formData, 'description'),
    }
    if (newSlug !== slug) {
      if (!PROGRAM_AREA_SLUG_PATTERN.test(newSlug)) {
        throw new ActionError('Slug must be lowercase letters, digits, - or _')
      }
      if (await slugInUse(supabase, slug)) {
        throw new ActionError('This slug is already used by proposals and can no longer change')
      }
      update.slug = newSlug
    }

    const { error } = await supabase.from('program_areas').update(update).eq('slug', slug)
    if (error) {
      throw new ActionError(
        error.code === '23505'
          ? `A program area with slug "${newSlug}" already exists`
          : error.message
      )
    }
    revalidatePath('/', 'layout')
  })
}

/** Inactive areas stay on existing records but can't be picked for new ones */
export async function setProgramAreaActive(
  slug: string,
  isActive: boolean
): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()
    const { error } = await supabase
      .from('program_areas')
      .update({ is_active: isActive })
      .eq('slug', slug)
    if (error) throw new ActionError(error.message)
    revalidatePath('/', 'layout')
  })
}

/** Swap an area with its neighbor in display order */
export async function moveProgramArea(
  slug: string,
  direction: 'up' | 'down'
): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()
    const { data: areas, error } = await supabase
      .from('program_areas')
      .select('slug, sort_order')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (error) throw new ActionError(error.message)

    const list = areas ?? []
    const index = list.findIndex((a) => a.slug === slug)
    const swapWith = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || swapWith < 0 || swapWith >= list.length) return

    // Renumber everything so ties from hand-edited data can't stall a move
    const ordered = [...list]
    ;[ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]]
    for (const [i, area] of ordered.entries()) {
      const sortOrder = (i + 1) * 10
      if (area.sort_order === sortOrder) continue
      const { error: updateError } = await supabase
        .from('program_areas')
        .update({ sort_order: sortOrder })
        .eq('slug', area.slug)
      if (updateError) throw new ActionError(updateError.message)
    }
    revalidatePath('/', 'layout')
  })
}

/** Only areas no proposal has ever used can be deleted; deactivate the rest */
export async function deleteProgramArea(slug: string): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()
    if (await slugInUse(supabase, slug)) {
      throw new ActionError('Proposals use this program area; deactivate it instead')
    }
    const { error } = await supabase.from('program_areas').delete().eq('slug', slug)
    if (error) throw new ActionError(error.message)
    revalidatePath('/', 'layout')
  })
}

// ---------------------------------------------------------------------------
// Letter signature image (admin-only)

async function uploadSignature(formData: FormData) {
  await requireAdminId()
  const file = formData.get('signature')
  if (!(file instanceof File) || file.size === 0) throw new ActionError('Choose an image to upload')
  if (!(SIGNATURE_TYPES as readonly string[]).includes(file.type)) {
    throw new ActionError('The signature must be a PNG or JPEG image')
  }
  if (file.size > SIGNATURE_MAX_BYTES) throw new ActionError('The signature image must be 1 MB or smaller')

  const supabase = await createClient()
  const { error } = await supabase.storage
    .from('letters')
    .upload(SIGNATURE_STORAGE_PATH, file, { contentType: file.type, upsert: true })
  if (error) throw new ActionError(error.message)
  revalidatePath('/settings')
}

export async function uploadSignatureAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  return asState(() => uploadSignature(formData))
}

export async function removeSignatureAction(): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()
    const { error } = await supabase.storage.from('letters').remove([SIGNATURE_STORAGE_PATH])
    if (error) throw new ActionError(error.message)
    revalidatePath('/settings')
  })
}

/** useActionState-compatible: saves Settings → Acknowledgement letters wording */
export async function updateLetterTemplatesAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  return asState(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const input = Object.fromEntries(
      LETTER_TEMPLATE_GROUPS.map((group) => [
        group,
        {
          opening: String(formData.get(`${group}.opening`) ?? ''),
          tax: String(formData.get(`${group}.tax`) ?? ''),
        },
      ])
    ) as Record<LetterTemplateGroup, LetterTemplate>
    const result = buildLetterTemplateOverrides(input)
    if (!result.ok) throw new ActionError(result.error)

    const { error } = await supabase
      .from('org_settings')
      .update({ letter_templates: result.overrides as Json })
      .eq('id', 1)
    if (error) throw new ActionError(error.message)

    revalidatePath('/settings')
  })
}
