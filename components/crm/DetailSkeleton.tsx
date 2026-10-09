/** Loading placeholder for the Organization and Person detail pages. */
export default function DetailSkeleton({ shape }: { shape: 'round' | 'square' }) {
  return (
    <div className="max-w-5xl mx-auto" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="flex items-start gap-6 mb-8">
        <div className={`h-24 w-24 bg-gray-200 animate-pulse ${shape === 'round' ? 'rounded-full' : 'rounded-lg'}`} />
        <div className="flex-1">
          <div className="h-9 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="h-5 w-40 bg-gray-200 rounded animate-pulse mt-3" />
          <div className="flex gap-2 mt-3">
            <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
            <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
          </div>
        </div>
      </div>
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-6">
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4" />
            <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-gray-200 rounded animate-pulse mt-2" />
            <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse mt-2" />
          </div>
        ))}
      </div>
    </div>
  )
}
