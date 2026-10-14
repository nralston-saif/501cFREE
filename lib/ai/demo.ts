import { isDemoMode } from '@/lib/supabase/demo/mock-client'

// When the AI features use the scripted provider (lib/ai/demo-scripts.ts)
// instead of Claude: in demo mode with no ANTHROPIC_API_KEY. That is what a
// public demo runs as, so every AI feature works there without a key and
// labels its output "Demo: sample AI output". With a key, demo mode calls
// Claude as before; outside demo mode, no key still means the features hide
// or explain themselves.

export { DEMO_AI_MODEL, DEMO_AI_LABEL } from './demo-label'

export function isScriptedAi(): boolean {
  return isDemoMode() && !process.env.ANTHROPIC_API_KEY
}

/** True when an AI feature can run: a real key, or the scripted demo provider */
export function isAiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || isScriptedAi()
}

/**
 * A short pause (about 1 to 2 seconds, varied by `seed`) so scripted results
 * feel like a model call and the "working" states are visible.
 */
export async function demoAiDelay(seed = ''): Promise<void> {
  let n = 0
  for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) % 1000
  await new Promise((resolve) => setTimeout(resolve, 1000 + n))
}
