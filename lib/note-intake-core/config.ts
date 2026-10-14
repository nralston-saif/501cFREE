import { isAiAvailable } from '@/lib/ai/demo'

// The lightweight half of the notes-inbox pipeline: safe to import from any
// page. The Claude pipeline itself (Anthropic SDK, sharp, mammoth, xlsx)
// lives in './server' and is loaded only by the processing route, with a
// dynamic import, so pages never trace or bundle those libraries.

/**
 * On with ANTHROPIC_API_KEY, or in demo mode with the scripted provider
 * (lib/ai/demo.ts). In demo mode the drop zone stages files through the
 * stageNoteIntakeFile server action into the demo store, since the browser
 * Supabase client is a stub there.
 */
export function isNoteIntakeEnabled(): boolean {
  return isAiAvailable()
}

/** A failure whose message is safe to show the uploader */
export class NoteIntakeError extends Error {}
