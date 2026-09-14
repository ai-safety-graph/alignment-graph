import { tagToColor } from '../lib/colors'

interface TagChipsProps {
  tags: string[]
  isLoading?: boolean
  /** Space-constrained rows (list/search rows) truncate to this many chips
   * plus a "+N" affordance; detail panels pass no max and show every tag. */
  max?: number
}

export default function TagChips({ tags, isLoading = false, max }: TagChipsProps) {
  if (isLoading) {
    return (
      <span
        className='inline-block h-3 w-16 rounded bg-neutral-800 align-middle animate-pulse'
        aria-hidden
      />
    )
  }
  if (tags.length === 0) {
    return <span className='text-neutral-500'>Untagged</span>
  }
  const shown = max ? tags.slice(0, max) : tags
  const hidden = tags.length - shown.length

  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      {shown.map((tag, i) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-1 ${i === 0 ? 'text-neutral-200' : 'text-neutral-400'}`}
        >
          <span
            className='inline-block w-2 h-2 rounded-full border border-[#333333]'
            style={{ background: tagToColor(tag) }}
            aria-hidden
          />
          {tag}
        </span>
      ))}
      {hidden > 0 && (
        <span className='text-neutral-500'>+{hidden}</span>
      )}
    </span>
  )
}
