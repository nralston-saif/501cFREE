// Client-safe constants for the scripted (demo-mode) AI provider. Kept free of
// imports so client components can read them without pulling in server code.

/** Stored in the `model` column of research runs and notes-inbox drops made by the scripted provider */
export const DEMO_AI_MODEL = 'demo-sample-output'

/** The label every demo AI result carries in the UI */
export const DEMO_AI_LABEL = 'Demo: sample AI output'
