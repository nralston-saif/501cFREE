import { initials } from '@/lib/contacts/crm'

const SIZES = {
  sm: { box: 'h-8 w-8', text: 'text-xs' },
  md: { box: 'h-10 w-10', text: 'text-sm' },
  lg: { box: 'h-12 w-12', text: 'text-base' },
  xl: { box: 'h-24 w-24', text: 'text-3xl' },
}

/** A contact's photo (round) or logo (rounded square), falling back to
 * initials. `src` is a signed URL. */
export default function Avatar({
  name,
  src,
  shape = 'round',
  size = 'md',
}: {
  name: string
  src?: string | null
  shape?: 'round' | 'square'
  size?: keyof typeof SIZES
}) {
  const { box, text } = SIZES[size]
  const rounding = shape === 'round' ? 'rounded-full' : 'rounded-lg'
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs; next/image would cache them
      <img
        src={src}
        alt={name}
        className={`${box} ${rounding} flex-shrink-0 ${
          shape === 'round' ? 'object-cover' : 'object-contain border border-gray-200 bg-white p-1'
        }`}
      />
    )
  }
  return (
    <div
      className={`${box} ${rounding} flex-shrink-0 bg-gray-100 border border-gray-200 flex items-center justify-center`}
      aria-hidden="true"
    >
      <span className={`${text} font-semibold text-gray-400`}>{initials(name)}</span>
    </div>
  )
}
