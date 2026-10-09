'use client'

import { useSyncExternalStore } from 'react'

// Pages that read the URL once, on the client (avoiding a Suspense boundary
// for useSearchParams, or because the server never sees the fragment). There
// is nothing to subscribe to: the values are read after hydration and these
// pages navigate away rather than changing their own URL.
const subscribe = () => () => {}

/** `window.location.search` on the client; null during SSR and hydration. */
export function useLocationSearch(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => null
  )
}

/** `window.location.hash` on the client; null during SSR and hydration. */
export function useLocationHash(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => null
  )
}
