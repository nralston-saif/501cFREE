'use client'

import { useEffect, type ReactNode } from 'react'

/** Centered dialog with a header, scrollable body and footer. Escape and a
 * backdrop click close it unless `busy`. */
export default function Modal({
  title,
  subtitle,
  onClose,
  busy = false,
  footer,
  size = 'md',
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  busy?: boolean
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div className={`relative bg-white rounded-xl shadow-xl w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 p-2 -m-2"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-end gap-3 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
