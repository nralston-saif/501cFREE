import PageSkeleton from '@/components/PageSkeleton'

// Fallback for every signed-in page without a closer loading.tsx: the nav
// stays put and a placeholder shows while the page's data loads.
export default function AppLoading() {
  return <PageSkeleton layout="sections" />
}
