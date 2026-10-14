'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Demo mode's fake "AI is working" state: run() shows `running` for `delayMs`,
 * then stores what `make()` returns. Everything happens in the browser; no
 * request is sent and nothing is saved.
 */
export function useDemoRun<T>(delayMs: number) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const run = useCallback(
    (make: () => T) => {
      if (timer.current) clearTimeout(timer.current)
      setRunning(true)
      timer.current = setTimeout(() => {
        timer.current = null
        setResult(make())
        setRunning(false)
      }, delayMs)
    },
    [delayMs]
  )

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setRunning(false)
    setResult(null)
  }, [])

  return { running, result, run, reset }
}
