/**
 * One embedded row, whichever shape it arrives in. PostgREST returns a
 * one-to-one embed (the hinted column is unique on the embedded table, like
 * acknowledgement_letters.contribution_id) as an object or null, while the
 * demo client returns every embed whose column lives on the embedded table
 * as an array. Missing (unresolved) embeds come back as null.
 */
export function oneEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
