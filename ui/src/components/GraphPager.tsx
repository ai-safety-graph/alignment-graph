import { ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_BUTTON =
  'p-0.5 rounded text-neutral-400 hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-neutral-400'

// A graph's paper count (pageLabel) between Newer/Older arrows, which only
// show when the recipe has more than one page.
export default function GraphPager({
  label,
  canNewer,
  canOlder,
  onNewer,
  onOlder,
}: {
  label: string
  canNewer: boolean
  canOlder: boolean
  onNewer: () => void
  onOlder: () => void
}) {
  const paged = canNewer || canOlder
  return (
    <span className='flex items-center gap-1 text-[13px] text-neutral-500 whitespace-nowrap'>
      {paged && (
        <button
          type='button'
          onClick={onNewer}
          disabled={!canNewer}
          aria-label='Newer papers'
          title='Newer papers'
          className={PAGE_BUTTON}
        >
          <ChevronLeft size={15} />
        </button>
      )}
      {label}
      {paged && (
        <button
          type='button'
          onClick={onOlder}
          disabled={!canOlder}
          aria-label='Older papers'
          title='Older papers'
          className={PAGE_BUTTON}
        >
          <ChevronRight size={15} />
        </button>
      )}
    </span>
  )
}
