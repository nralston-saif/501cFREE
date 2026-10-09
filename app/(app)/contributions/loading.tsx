import PageSkeleton from '@/components/PageSkeleton'

// Contributions list (summary card + table) and detail pages
export default function ContributionsLoading() {
  return <PageSkeleton layout="table" stats={3} />
}
