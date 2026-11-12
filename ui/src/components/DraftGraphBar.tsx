import { useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_GRAPH_NAME_LENGTH } from '../lib/storage'
import type { SharedGraph } from '../lib/shareLink'
import FilterChips from './FilterChips'
import ShareLinkButton from './ShareLinkButton'

const BUTTON =
  'shrink-0 whitespace-nowrap px-2.5 py-1 rounded-md border border-neutral-700 text-[13px] text-neutral-300 hover:text-white hover:border-neutral-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
const PRIMARY_BUTTON =
  'shrink-0 whitespace-nowrap px-2.5 py-1 rounded-md border border-[#4ea8de]/50 bg-[#4ea8de]/15 text-[13px] font-medium text-[#8cc8ee] hover:bg-[#4ea8de]/25 hover:border-[#4ea8de]/70 hover:text-[#b3dbf5] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// Action bar for an unsaved graph (generated from filters, or opened from a
// share link): save it (as new, or over the saved graph it was edited from),
// edit its filters, share it as it stands, or discard it.
export default function DraftGraphBar({
  pager,
  empty,
  defaultName,
  basedOnName,
  chips,
  chipsTitle,
  onSave,
  onUpdate,
  onEdit,
  onDiscard,
  shareGraph,
}: {
  // Paper count and Newer/Older controls (GraphPager)
  pager: ReactNode
  // Nothing to save: the recipe matched no papers and none were added
  empty: boolean
  defaultName: string
  // Name of the saved graph this draft was edited from, if any
  basedOnName?: string
  // The draft's recipe in short (filterSummary), and in full for the tooltip
  chips: string[]
  chipsTitle: string
  // Returns an error message when the graph can't be saved
  onSave: (name: string) => string | null
  onUpdate: () => string | null
  onEdit: () => void
  onDiscard: () => void
  // The draft as a share link carries it
  shareGraph: SharedGraph | null
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const startNaming = () => {
    setName(defaultName)
    setError(null)
    setNaming(true)
  }

  const confirmSave = () => {
    const trimmed = name.trim().slice(0, MAX_GRAPH_NAME_LENGTH)
    if (!trimmed) return
    const err = onSave(trimmed)
    setError(err)
    if (!err) setNaming(false)
  }

  return (
    <div className='flex flex-col-reverse items-center gap-1'>
      <div className='max-w-[56rem] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-950/95 shadow-lg'>
        {naming ? (
          <>
            <input
              autoFocus
              aria-label='Graph name'
              value={name}
              maxLength={MAX_GRAPH_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmSave()
                else if (e.key === 'Escape') {
                  // Keep the graph's own Esc handler from deselecting too
                  e.stopPropagation()
                  setNaming(false)
                }
              }}
              className='w-56 px-2 py-0.5 rounded-md bg-neutral-900 border border-[#333333] text-[13px] text-[#e5e5e5] outline-none focus:ring-2 focus:ring-[#4ea8de]'
            />
            <button
              type='button'
              onClick={confirmSave}
              disabled={!name.trim()}
              className={PRIMARY_BUTTON}
            >
              Save
            </button>
            <button
              type='button'
              onClick={() => setNaming(false)}
              className={BUTTON}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {/* The picker already says it's unsaved, so the bar leads with
                the count and the recipe */}
            {pager}
            <FilterChips
              labels={chips}
              title={chipsTitle}
              className='grow basis-0 min-w-28'
            />
            {basedOnName ? (
              <>
                <button
                  type='button'
                  onClick={() => setError(onUpdate())}
                  disabled={empty}
                  title={`Replace “${basedOnName}” with this graph`}
                  className={`${PRIMARY_BUTTON} max-w-[200px] truncate`}
                >
                  Update “{basedOnName}”
                </button>
                <button
                  type='button'
                  onClick={startNaming}
                  disabled={empty}
                  className={BUTTON}
                >
                  Save as new
                </button>
              </>
            ) : (
              <button
                type='button'
                onClick={startNaming}
                disabled={empty}
                className={PRIMARY_BUTTON}
              >
                Save
              </button>
            )}
            <button type='button' onClick={onEdit} className={BUTTON}>
              Edit
            </button>
            {shareGraph && !empty && (
              <ShareLinkButton
                graph={shareGraph}
                view='graph'
                iconSize={13}
                className={`${BUTTON} flex items-center gap-1`}
              />
            )}
            <button type='button' onClick={onDiscard} className={BUTTON}>
              Discard
            </button>
          </>
        )}
      </div>
      {error && <p className='text-xs text-red-400'>{error}</p>}
    </div>
  )
}
