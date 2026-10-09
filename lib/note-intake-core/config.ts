import { isDemoMode } from '@/lib/supabase/demo/mock-client'

// The lightweight half of the notes-inbox pipeline: safe to import from any
// page. The Claude pipeline itself (Anthropic SDK, sharp, mammoth, xlsx)
// lives in './server' and is loaded only by the processing route, with a
// dynamic import, so pages never trace or bundle those libraries.

/**
 * Off without ANTHROPIC_API_KEY, and always off in demo mode: the drop zone
 * uploads straight to Storage with the browser client, which demo mode
 * stubs out (auth only), so an upload there would crash.
 */
export function isNoteIntakeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && !isDemoMode()
}

/** A failure whose message is safe to show the uploader */
export class NoteIntakeError extends Error {}
