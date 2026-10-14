// Client-safe constants for demo mode's pre-written AI samples. Kept free of
// imports so client components can read them without pulling in server code.

/** The label every demo AI result carries in the UI */
export const DEMO_AI_LABEL = 'Demo: sample AI output'

/** How long each demo feature shows its "working" state before the sample appears */
export const DEMO_DELAY_MS = {
  research: 3000,
  declineEmail: 2000,
  notesInbox: 3000,
  invoices: 3000,
} as const

const SAMPLE = 'Demo: this is a pre-written sample.'

/** The notes shown above each demo result */
export const DEMO_NOTES = {
  research: `${SAMPLE} In a real installation the AI researches the web (and any attached letter or instrument) and drafts these answers for you to review.`,
  declineEmail: `${SAMPLE} In a real installation the AI drafts this email from the proposal and your team's decision, for you to edit, copy into your email client and mark sent.`,
  notesInbox: `${SAMPLE} In a real installation the AI reads your files (typed notes, documents, photos of handwritten pages) and proposes these notes, links and new contacts for you to review before anything is filed.`,
  invoices: `${SAMPLE} In a real installation the AI reads each invoice or receipt and pre-fills these fields as expenses for you to review before anything is created.`,
} as const
