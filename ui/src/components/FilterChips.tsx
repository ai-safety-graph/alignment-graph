// A graph's recipe as small read-only chips on one line. A long recipe ends
// in an ellipsis; the full list is in the tooltip.
export default function FilterChips({
  labels,
  className = '',
}: {
  labels: string[]
  className?: string
}) {
  if (labels.length === 0) return null
  return (
    <span
      title={labels.join(', ')}
      className={`min-w-0 line-clamp-1 text-xs text-neutral-500 ${className}`}
    >
      {labels.map((label) => (
        <span
          key={label}
          className='inline-block mr-1.5 px-1.5 leading-4 rounded-full border border-neutral-700 whitespace-nowrap'
        >
          {label}
        </span>
      ))}
    </span>
  )
}
