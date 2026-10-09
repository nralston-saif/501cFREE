export default function PeopleLoading() {
  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="h-6 w-10 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* Search, pills, status and sort */}
      <div className="h-12 w-full bg-gray-200 rounded-lg animate-pulse mb-4" />
      <div className="flex flex-wrap gap-2 mb-6">
        {[16, 24, 18, 18, 20].map((w, i) => (
          <div key={i} className="h-8 bg-gray-200 rounded-full animate-pulse" style={{ width: `${w * 4}px` }} />
        ))}
        <div className="ml-auto h-8 w-60 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 bg-gray-200 rounded-full animate-pulse" />
              <div className="flex-1">
                <div className="h-5 w-36 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-28 bg-gray-200 rounded animate-pulse mt-2" />
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mt-1" />
                <div className="h-5 w-16 bg-gray-200 rounded animate-pulse mt-2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
