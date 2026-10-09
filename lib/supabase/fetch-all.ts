// Every row of a query, a page at a time.
//
// PostgREST caps each response at the project's `max_rows` (1000 by default
// on Supabase), and a capped response looks exactly like a complete one: no
// error, just fewer rows. Use fetchAll() wherever the whole result is
// genuinely needed (reports, CSV exports, pickers and lists that filter on
// the client). Prefer filtering, counting ({ count: 'exact', head: true }) or
// aggregating in SQL when the page only needs a subset or a total.

/** Matches Supabase's default max_rows. Don't set max_rows below this. */
export const FETCH_ALL_PAGE_SIZE = 1000

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

/** Anything with PostgREST's range(): a select or rpc builder (or the demo mock). */
export type RangeableQuery<T> = {
  range(from: number, to: number): PromiseLike<PageResult<T>>
}

/** Same, for queries whose row type the hand-written types can't infer
 * (embedded selects): pass the row type explicitly, `fetchAll<Row>(...)`. */
type UntypedRangeableQuery = {
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Runs `build()` once per page and concatenates the rows. `build` must return
 * a fresh query each time, ordered by a unique key (e.g. `.order('id')` as
 * the last ordering) so pages neither overlap nor skip rows. Throws on a
 * query error instead of returning a partial list.
 */
export async function fetchAll<T>(
  build: () => RangeableQuery<T> | UntypedRangeableQuery,
  { pageSize = FETCH_ALL_PAGE_SIZE }: { pageSize?: number } = {}
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw new Error(`Could not load every row: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
}

/** Ids per `.in()` lookup: keeps the request URL well under proxy limits. */
export const IN_CHUNK_SIZE = 150

/**
 * Looks rows up by a list of ids (or other keys) in chunks, so a long list
 * neither overflows the URL nor hits max_rows. `build(chunk)` returns the
 * query for one chunk, e.g. `(ids) => supabase.from('contacts').select('id, display_name').in('id', ids)`.
 * Each chunk must return at most FETCH_ALL_PAGE_SIZE rows (one row per key is typical).
 */
export async function fetchByKeys<T, K>(
  keys: readonly K[],
  build: (chunk: K[]) => PromiseLike<PageResult<T>> | PromiseLike<{ data: unknown; error: { message: string } | null }>,
  { chunkSize = IN_CHUNK_SIZE }: { chunkSize?: number } = {}
): Promise<T[]> {
  const unique = [...new Set(keys)]
  const chunks: K[][] = []
  for (let i = 0; i < unique.length; i += chunkSize) chunks.push(unique.slice(i, i + chunkSize))
  const results = await Promise.all(chunks.map((chunk) => build(chunk)))
  const out: T[] = []
  for (const { data, error } of results) {
    if (error) throw new Error(`Could not load every row: ${error.message}`)
    out.push(...((data ?? []) as T[]))
  }
  return out
}
