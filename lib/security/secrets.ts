import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time check of a presented secret against the expected one. Both
 * sides are hashed first so the comparison never leaks the expected length.
 * A missing or empty expected secret always fails (endpoints fail closed).
 */
export function secretMatches(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !presented) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
