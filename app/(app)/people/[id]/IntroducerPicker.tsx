'use client'

import ContactSearch from '@/components/crm/ContactSearch'
import type { Introducer } from './PersonView'

/** "Introduced by": the current introducer with Change/Clear, or a person search. */
export default function IntroducerPicker({
  personId,
  value,
  onChange,
}: {
  personId: string
  value: Introducer | null
  onChange: (next: Introducer | null) => void
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">Introduced by</span>
      {value ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2 border border-gray-200 rounded-lg bg-white">
          <span className="text-sm text-gray-900">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-500 hover:text-gray-800">
            Clear
          </button>
        </div>
      ) : (
        <ContactSearch
          kind="person"
          label="Search for who introduced them"
          placeholder="Search people…"
          excludeIds={[personId]}
          onPick={(hit) => onChange({ id: hit.id, name: hit.display_name, kind: hit.kind })}
        />
      )}
    </div>
  )
}
