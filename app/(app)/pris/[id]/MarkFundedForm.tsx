'use client'

import { useState, useTransition } from 'react'
import { markPriFunded } from '@/lib/actions/pris'
import { useToast } from '@/components/Toast'
import { unwrap } from '@/lib/actions/result'

export default function MarkFundedForm({
  priId,
  ready,
}: {
  priId: string
  /** All compliance requirements met (server also re-checks on submit). */
  ready: boolean
}) {
  const [fundedDate, setFundedDate] = useState('')
  const [method, setMethod] = useState('wire')
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleSubmit = () => {
    const formData = new FormData()
    formData.set('funded_date', fundedDate)
    formData.set('method', method)
    startTransition(async () => {
      try {
        unwrap(await markPriFunded(priId, formData))
        showToast('PRI marked funded', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not mark funded', 'error')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
      <div>
        <label htmlFor="funded_date" className="block text-xs font-medium text-gray-500 mb-1">
          Funded date
        </label>
        <input
          id="funded_date"
          type="date"
          value={fundedDate}
          onChange={(e) => setFundedDate(e.target.value)}
          className="input"
        />
        <p className="text-xs text-gray-400 mt-1">Blank = today</p>
      </div>
      <div>
        <label htmlFor="funded_method" className="block text-xs font-medium text-gray-500 mb-1">
          Method
        </label>
        <select
          id="funded_method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="input"
        >
          <option value="wire">Wire</option>
          <option value="ach">ACH</option>
          <option value="check">Check</option>
        </select>
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || !ready}
        className="btn btn-primary disabled:opacity-50"
      >
        {isPending ? 'Marking…' : 'Mark funded'}
      </button>
    </div>
  )
}
