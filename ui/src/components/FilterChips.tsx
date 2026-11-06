// A graph's recipe as small read-only chips on one line. A long recipe ends
// in an ellipsis, as does a single chip wider than the space; the full list
// is in the tooltip. Chips are spaced from the
// left, as a trailing margin on the last one would wrap it a few px early.
export default function FilterChips({
  labels,
  title = labels.join(', '),
  className = '',
}: {
  labels: string[]
  // Defaults to the labels; a summary passes the full recipe
  title?: string
  className?: string
}) {
  if (labels.length === 0) return null
  return (
    <span
      title={title}
      className={`min-w-0 line-clamp-1 text-xs text-neutral-500 [&>span+span]:ml-1.5 ${className}`}
    >
      {labels.map((label) => (
        <span
          key={label}
          className='inline-block max-w-full truncate align-bottom px-1.5 leading-4 rounded-full border border-neutral-700'
        >
          {label}
        </span>
      ))}
    </span>
  )
}
