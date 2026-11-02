import { useState } from 'react'
import { MAX_GRAPH_NAME_LENGTH } from '../lib/storage'

const BUTTON =
  'px-2.5 py-1 rounded-md border border-neutral-700 text-[13px] text-neutral-300 hover:text-white hover:border-neutral-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
const PRIMARY_BUTTON =
  'px-2.5 py-1 rounded-md bg-[#4ea8de] text-[13px] font-medium text-neutral-950 hover:bg-[#6bb8e6] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

// Action bar for an unsaved, filter-generated graph: save it (as new, or over
// the saved graph it was edited from), edit its filters, or discard it.
export default function DraftGraphBar({
  shown,
  total,
  defaultName,
  basedOnName,
  onSave,
  onUpdate,
  onEdit,
  onDiscard,
}: {
  shown: number
  total: number
  defaultName: string
  // Name of the saved graph this draft was edited from, if any
  basedOnName?: string
  // Returns an error message when the graph can't be saved
  onSave: (name: string) => string | null
  onUpdate: () => string | null
  onEdit: () => void
  onDiscard: () => void
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

  const countLabel =
    total > shown
      ? `newest ${shown.toLocaleString()} of ${total.toLocaleString()} papers`
      : `${shown.toLocaleString()} ${shown === 1 ? 'paper' : 'papers'}`

  return (
    <div className='flex flex-col-reverse items-center gap-1'>
      <div className='flex items-center gap-3 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-950/95 shadow-lg'>
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
            <span className='text-[13px] text-neutral-300 whitespace-nowrap'>
              Unsaved graph
              <span className='text-neutral-500'> · {countLabel}</span>
            </span>
            {basedOnName ? (
              <>
                <button
                  type='button'
                  onClick={() => setError(onUpdate())}
                  disabled={shown === 0}
                  title={`Replace “${basedOnName}” with this graph`}
                  className={`${PRIMARY_BUTTON} max-w-[200px] truncate`}
                >
                  Update “{basedOnName}”
                </button>
                <button
                  type='button'
                  onClick={startNaming}
                  disabled={shown === 0}
                  className={BUTTON}
                >
                  Save as new
                </button>
              </>
            ) : (
              <button
                type='button'
                onClick={startNaming}
                disabled={shown === 0}
                className={PRIMARY_BUTTON}
              >
                Save
              </button>
            )}
            <button type='button' onClick={onEdit} className={BUTTON}>
              Edit
            </button>
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
