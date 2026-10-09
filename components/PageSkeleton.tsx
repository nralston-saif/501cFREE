// Loading placeholders for route segments (app/(app)/**/loading.tsx). Same
// visual language as the people/organizations skeletons: gray-200 blocks
// with animate-pulse inside the usual `card` containers. The nav shell stays
// interactive while these show, because loading.tsx sits below the layout.

const bar = 'bg-gray-200 rounded animate-pulse'

function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className={`h-8 w-48 ${bar}`} />
        <div className={`h-4 w-72 mt-2 ${bar}`} />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <div key={i} className={`h-9 w-32 ${bar}`} />
        ))}
      </div>
    </div>
  )
}

function StatsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-5">
          <div className={`h-3 w-24 ${bar}`} />
          <div className={`h-7 w-32 mt-2 ${bar}`} />
        </div>
      ))}
    </div>
  )
}

function TabsSkeleton({ count }: { count: number }) {
  return (
    <div className="flex gap-2 border-b border-gray-200 pb-2 mb-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`h-7 w-24 ${bar}`} />
      ))}
    </div>
  )
}

function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 px-4 py-3 border-b border-gray-100">
        {Array.from({ length: columns }, (_, i) => (
          <div key={i} className={`h-3 flex-1 ${bar}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3 border-b border-gray-50">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className={`h-4 flex-1 ${bar}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-4">
          <div className={`h-5 w-3/4 ${bar}`} />
          <div className={`h-4 w-1/2 mt-2 ${bar}`} />
          <div className={`h-4 w-1/3 mt-2 ${bar}`} />
        </div>
      ))}
    </div>
  )
}

function SectionsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-5">
          <div className={`h-5 w-40 mb-4 ${bar}`} />
          <div className={`h-4 w-full ${bar}`} />
          <div className={`h-4 w-5/6 mt-2 ${bar}`} />
          <div className={`h-4 w-2/3 mt-2 ${bar}`} />
        </div>
      ))}
    </div>
  )
}

export type PageSkeletonLayout = 'dashboard' | 'table' | 'tabs-table' | 'board' | 'list' | 'sections'

/** A page-shaped placeholder: header, then the layout's main block. */
export default function PageSkeleton({ layout = 'table', stats = 0 }: { layout?: PageSkeletonLayout; stats?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      {stats > 0 && <StatsSkeleton count={stats} />}
      {layout === 'dashboard' && (
        <>
          <StatsSkeleton count={4} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionsSkeleton count={1} />
            <SectionsSkeleton count={1} />
          </div>
        </>
      )}
      {layout === 'table' && <TableSkeleton />}
      {layout === 'tabs-table' && (
        <>
          <TabsSkeleton count={3} />
          <TableSkeleton />
        </>
      )}
      {layout === 'board' && (
        <>
          <TabsSkeleton count={4} />
          <CardGridSkeleton />
        </>
      )}
      {layout === 'list' && <TableSkeleton rows={6} columns={2} />}
      {layout === 'sections' && <SectionsSkeleton />}
    </div>
  )
}
