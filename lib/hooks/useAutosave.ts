'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/**
 * Debounced autosave over a serializable value. Saves `delay` ms after the
 * last change, retries automatically on failure, and warns before the tab
 * unloads while changes are unsaved. `flush()` saves immediately (used by a
 * Done button before closing the editor).
 */
export function useAutosave<T>(
  data: T,
  save: (data: T) => Promise<void>,
  { enabled, delay = 1500 }: { enabled: boolean; delay?: number }
) {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const serialized = useMemo(() => JSON.stringify(data), [data])
  // What was last saved: state for rendering, plus a ref that async code can
  // read synchronously right after a save settles (flush()).
  const [savedSerialized, setSavedSerialized] = useState(serialized)
  const savedRef = useRef(serialized)
  const dataRef = useRef(data)
  const inflightRef = useRef<Promise<void> | null>(null)
  const saveRef = useRef(save)
  // Latest data/save for the async save loop; synced after commit, before
  // any timer or event handler can read them.
  useLayoutEffect(() => {
    dataRef.current = data
    saveRef.current = save
  })

  // Mark unsaved changes as soon as they render (adjusting state during
  // render): a save in flight or a failed one keeps its own status.
  if (
    enabled &&
    serialized !== savedSerialized &&
    status !== 'saving' &&
    status !== 'error' &&
    status !== 'dirty'
  ) {
    setStatus('dirty')
  }

  const runSave = useCallback(async () => {
    if (inflightRef.current) return
    const snapshot = dataRef.current
    const serialized = JSON.stringify(snapshot)
    if (serialized === savedRef.current) return
    setStatus('saving')
    const attempt = (async () => {
      try {
        await saveRef.current(snapshot)
        savedRef.current = serialized
        setSavedSerialized(serialized)
        setStatus(JSON.stringify(dataRef.current) === serialized ? 'saved' : 'dirty')
      } catch {
        setStatus('error')
      }
    })()
    inflightRef.current = attempt
    try {
      await attempt
    } finally {
      inflightRef.current = null
    }
  }, [])

  // Debounce: (re)arm a timer on every change; also drives the retry-on-error
  // loop, since a failed save leaves savedRef stale.
  useEffect(() => {
    if (!enabled) return
    if (serialized === savedRef.current) return
    const timer = setTimeout(runSave, delay)
    return () => clearTimeout(timer)
  }, [data, serialized, enabled, delay, runSave, status])

  const flush = useCallback(async () => {
    if (inflightRef.current) await inflightRef.current
    await runSave()
    if (JSON.stringify(dataRef.current) !== savedRef.current) {
      throw new Error('Could not save changes')
    }
  }, [runSave])

  useEffect(() => {
    if (!enabled || status === 'idle' || status === 'saved') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [enabled, status])

  return { status, flush }
}
