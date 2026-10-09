// Marker written at the start of a QBO Purchase's PrivateNote when the app
// creates that Purchase ("Send to QuickBooks"). The pull sync recognizes the
// marker and records the transaction as an echo of the app's own expense
// instead of a new bank transaction to review.
//
// The wording is deliberately fixed (not derived from NEXT_PUBLIC_APP_NAME):
// renaming the app must not break echo detection for Purchases already in
// QuickBooks. Format: "Expense <uuid> (sent from back office)".

const MARKER_SUFFIX = '(sent from back office)'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ECHO_NOTE_RE = new RegExp(`^Expense (${UUID}) \\(sent from back office\\)`, 'i')

export function echoMarker(expenseId: string): string {
  return `Expense ${expenseId} ${MARKER_SUFFIX}`
}

/** The expense id from a PrivateNote that starts with the echo marker, else null */
export function parseEchoMarker(privateNote: string | null | undefined): string | null {
  const match = privateNote?.match(ECHO_NOTE_RE)
  return match ? match[1].toLowerCase() : null
}
