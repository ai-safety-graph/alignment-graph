import { tagIcon } from '../lib/tags'

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
      {shown.map((tag) => {
        const Icon = tagIcon(tag)
        return (
          <span
            key={tag}
            className='inline-flex items-center gap-1 text-neutral-300'
          >
            <Icon size={12} className='shrink-0' aria-hidden />
            {tag}
          </span>
        )
      })}
      {hidden > 0 && (
        <span className='text-neutral-500'>+{hidden}</span>
      )}
    </span>
  )
}
