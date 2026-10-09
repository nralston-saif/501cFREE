'use client'

import { useEffect, useRef, useState } from 'react'

interface HelpTipProps {
  /** Heading shown at the top of the popover and used as the button's aria-label. */
  title?: string
  children: React.ReactNode
}

/** Small "?" button that toggles an accessible popover. Closes on outside-click / Escape. */
export default function HelpTip({ title, children }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span className="relative inline-flex align-middle" ref={ref}>
      <button
        type="button"
        aria-label={title ?? 'More information'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-5 top-0 z-20 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600 shadow-lg"
        >
          {title && <p className="mb-1 font-medium text-gray-800">{title}</p>}
          {children}
        </div>
      )}
    </span>
  )
}
