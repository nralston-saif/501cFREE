import Link from 'next/link'

/**
 * Table header cell that sorts by linking to the same page with new sort
 * params (the page computes `href`). Shows ▲/▼ on the active column.
 */
export default function SortableTh({
  label,
  href,
  active,
  align = 'left',
}: {
  label: string
  href: string
  /** Direction when this column is the active sort, else null. */
  active: 'asc' | 'desc' | null
  align?: 'left' | 'right'
}) {
  return (
    <th
      scope="col"
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      <Link
        href={href}
        scroll={false}
        className={`inline-flex items-center gap-1 hover:text-gray-900 ${
          active ? 'text-gray-900' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <span aria-hidden className={`text-[10px] ${active ? '' : 'invisible'}`}>
          {active === 'asc' ? '▲' : '▼'}
        </span>
      </Link>
    </th>
  )
}
