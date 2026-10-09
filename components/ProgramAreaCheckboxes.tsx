import type { ProgramAreaOption } from '@/lib/program-areas'

/**
 * Program-area checkboxes for proposal forms (field name "program_areas").
 * Shows active areas plus any inactive area the record already carries, so
 * editing never silently drops a tag.
 */
export default function ProgramAreaCheckboxes({
  areas,
  selected = [],
  label = 'Program areas',
}: {
  areas: ProgramAreaOption[]
  selected?: string[]
  label?: string
}) {
  const visible = areas.filter((a) => a.is_active || selected.includes(a.slug))
  return (
    <fieldset className="border-0 p-0 m-0 min-w-0">
      <legend className="block text-sm font-medium text-gray-700 mb-2">{label}</legend>
      {visible.length === 0 ? (
        <p className="text-xs text-gray-400">
          No program areas defined yet. Admins can add them in Settings.
        </p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {visible.map((area) => (
            <label key={area.slug} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="program_areas"
                value={area.slug}
                defaultChecked={selected.includes(area.slug)}
                className="h-4 w-4 rounded border-gray-300"
              />
              {area.label}
              {!area.is_active && <span className="text-xs text-gray-400">(inactive)</span>}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
