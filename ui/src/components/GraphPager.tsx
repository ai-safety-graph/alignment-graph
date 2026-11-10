import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PINNED_RING_COLOR } from '../lib/graph'

const PAGE_BUTTON =
  'p-0.5 rounded text-neutral-400 hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-neutral-400'

// A graph's paper count (pageLabel) between Newer/Older arrows, which only
// show when the recipe has more than one page. When pins are on screen, their
// count follows the label as a toggle that shows only the pinned papers.
export default function GraphPager({
  label,
  pinned,
  pinnedOnly,
  onTogglePinnedOnly,
  paged,
  canNewer,
  canOlder,
  onNewer,
  onOlder,
}: {
  label: string
  // Pinned papers on screen; 0 hides the toggle
  pinned: number
  pinnedOnly: boolean
  onTogglePinnedOnly: () => void
  // Whether the graph has more than one page, so the arrows show. Separate
  // from canNewer/canOlder, which also go false while a page loads.
  paged: boolean
  canNewer: boolean
  canOlder: boolean
  onNewer: () => void
  onOlder: () => void
}) {
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
      {pinned > 0 && (
        <>
          <span aria-hidden='true'>·</span>
          {/* A filter toggle, so aria-pressed fits here (unlike PinToggle,
              whose name is the action) */}
          <button
            type='button'
            onClick={onTogglePinnedOnly}
            aria-pressed={pinnedOnly}
            title={pinnedOnly ? 'Show all papers' : 'Show only pinned papers'}
            style={pinnedOnly ? { color: PINNED_RING_COLOR } : undefined}
            className={`rounded px-0.5 -mx-0.5 cursor-pointer underline decoration-dotted underline-offset-[3px] transition-colors ${
              pinnedOnly
                ? 'font-medium decoration-solid'
                : 'decoration-neutral-600 hover:text-neutral-200 hover:decoration-neutral-400'
            }`}
          >
            {pinned.toLocaleString()} pinned
          </button>
        </>
      )}
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
