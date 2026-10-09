// Claude model ids used by the AI features, in one place so an installation
// can move to newer models with a one-line change. Every call tries its
// primary model and retries on FALLBACK_MODEL only when the primary refuses
// (stop_reason 'refusal'; invoice reading uses the API's server-side
// fallback for the same case). Overload and other API errors are not
// retried on the fallback: they surface as the feature's normal error.

/** Grant and PRI research memos, decline-email drafts */
export const RESEARCH_MODEL = 'claude-opus-5'

/** Structured extraction from documents: invoices and meeting notes */
export const EXTRACTION_MODEL = 'claude-opus-5-5'

export const FALLBACK_MODEL = 'claude-opus-4-8'
