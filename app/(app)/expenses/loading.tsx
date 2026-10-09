import PageSkeleton from '@/components/PageSkeleton'

// Expenses list (summary + table) and detail pages
export default function ExpensesLoading() {
  return <PageSkeleton layout="table" stats={4} />
}
