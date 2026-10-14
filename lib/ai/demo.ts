import { isDemoMode } from '@/lib/supabase/demo/mock-client'

// When the AI features show pre-written sample results (lib/ai/demo-scripts.ts)
// instead of calling Claude: in demo mode with no ANTHROPIC_API_KEY. That is
// what the public demo runs as. The samples are generated in the browser from
// data the page already has, never on the server: a hosted demo runs each
// route in its own serverless instance with its own in-memory store, so a
// result one request wrote would be invisible to the next page render.
// With a key, demo mode calls Claude as before; outside demo mode, no key
// still means the features hide or explain themselves.

export { DEMO_AI_LABEL } from './demo-label'

export function isScriptedAi(): boolean {
  return isDemoMode() && !process.env.ANTHROPIC_API_KEY
}

/** True when the server can call Claude (ANTHROPIC_API_KEY is set) */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** True when an AI feature should be offered in the UI: a real key, or the in-browser demo samples */
export function isAiAvailable(): boolean {
  return isAiConfigured() || isScriptedAi()
}
