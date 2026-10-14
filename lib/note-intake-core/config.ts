import { isAiConfigured } from '@/lib/ai/demo'

// The lightweight half of the notes-inbox pipeline: safe to import from any
// page. The Claude pipeline itself (Anthropic SDK, sharp, mammoth, xlsx)
// lives in './server' and is loaded only by the processing route, with a
// dynamic import, so pages never trace or bundle those libraries.

/**
 * On with ANTHROPIC_API_KEY. In demo mode with a key the drop zone stages
 * files through the stageNoteIntakeFile server action into the demo store,
 * since the browser Supabase client is a stub there. Demo mode without a key
 * shows sample notes made in the browser instead (lib/ai/demo.ts).
 */
export function isNoteIntakeEnabled(): boolean {
  return isAiConfigured()
}

/** A failure whose message is safe to show the uploader */
export class NoteIntakeError extends Error {}
