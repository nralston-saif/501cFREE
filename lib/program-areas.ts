import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ProgramArea } from '@/lib/supabase/types/database'

// Program areas are the organization's own taxonomy for tagging grant
// proposals and awards (edited in Settings). Records store slugs; the
// helpers here turn them back into labels. No server-only imports, so the
// label helpers are safe in client components too.

export type ProgramAreaOption = Pick<ProgramArea, 'slug' | 'label' | 'description' | 'is_active'>

/**
 * All program areas in display order. Inactive areas are included by
 * default because existing records may still reference them (for labels);
 * pass `activeOnly` for pickers and validation of new input.
 */
export async function loadProgramAreas(
  supabase: SupabaseClient<Database>,
  opts: { activeOnly?: boolean } = {}
): Promise<ProgramArea[]> {
  let query = supabase
    .from('program_areas')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  if (opts.activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new Error(`Could not load program areas: ${error.message}`)
  return (data ?? []) as ProgramArea[]
}

/** Label for a slug, or the slug itself if the area has since been removed */
export function programAreaLabel(areas: readonly Pick<ProgramArea, 'slug' | 'label'>[], slug: string): string {
  return areas.find((a) => a.slug === slug)?.label ?? slug
}

export function programAreaLabels(
  areas: readonly Pick<ProgramArea, 'slug' | 'label'>[],
  slugs: readonly string[]
): string[] {
  return slugs.map((s) => programAreaLabel(areas, s))
}

/**
 * Keep only values that are slugs of the given areas, de-duplicated, in the
 * areas' display order. Anything else (unknown slugs, non-strings) is dropped.
 */
export function pickProgramAreaSlugs(
  areas: readonly Pick<ProgramArea, 'slug'>[],
  input: unknown
): string[] {
  if (!Array.isArray(input)) return []
  const wanted = new Set(input.filter((v): v is string => typeof v === 'string'))
  return areas.filter((a) => wanted.has(a.slug)).map((a) => a.slug)
}

/** Derive a slug from a label: "Public Health & Safety" → "public-health-safety" */
export function slugifyProgramArea(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export const PROGRAM_AREA_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
