export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="card p-12 text-center text-gray-400 text-sm">{message}</div>
  )
}
