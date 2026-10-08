import { useLatestBatch } from '../hooks/useLatestBatch'

// `date` is a plain YYYY-MM-DD; build it as a local date so it isn't
// shifted a day back in timezones west of UTC.
function formatBatchDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export default function LatestBatchBadge({
  className = '',
}: {
  className?: string
}) {
  const batch = useLatestBatch()
  if (!batch) return null

  const papers = batch.added === 1 ? 'paper' : 'papers'
  return (
    <span
      title={`${batch.added.toLocaleString()} ${papers} added in the latest update (${batch.date})`}
      className={`text-xs text-neutral-500 whitespace-nowrap ${className}`}
    >
      {batch.added.toLocaleString()} {papers} added{' '}
      {formatBatchDate(batch.date)}
    </span>
  )
}
