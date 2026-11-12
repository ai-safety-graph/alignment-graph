import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { MAX_GRAPH_NAME_LENGTH } from '../lib/storage'

const BUTTON =
  'shrink-0 whitespace-nowrap px-2.5 py-1 rounded-md border border-neutral-700 text-[13px] text-neutral-300 hover:text-white hover:border-neutral-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
const PRIMARY_BUTTON =
  'shrink-0 whitespace-nowrap px-2.5 py-1 rounded-md border border-[#4ea8de]/50 bg-[#4ea8de]/15 text-[13px] font-medium text-[#8cc8ee] hover:bg-[#4ea8de]/25 hover:border-[#4ea8de]/70 hover:text-[#b3dbf5] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// Browse's bar for a graph opened from a share link: it isn't one of the
// user's graphs until they save it (under the shared name, or their own).
export default function SharedDraftBar({
  name: sharedName,
  onSave,
  onDiscard,
}: {
  name: string
  // Returns an error message when the graph can't be saved
  onSave: (name: string) => string | null
  onDiscard: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(sharedName)
  const [error, setError] = useState<string | null>(null)

  const confirmSave = () => {
    const trimmed = name.trim().slice(0, MAX_GRAPH_NAME_LENGTH)
    if (trimmed) setError(onSave(trimmed))
  }

  return (
    <div className='mx-4 mt-2 mb-1 px-3 py-2 rounded-lg border border-[#4ea8de]/30 bg-[#4ea8de]/5 text-[13px] text-neutral-300'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        {naming ? (
          <input
            autoFocus
            aria-label='Graph name'
            value={name}
            maxLength={MAX_GRAPH_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmSave()
              else if (e.key === 'Escape') setNaming(false)
            }}
            className='flex-1 min-w-40 px-2 py-0.5 rounded-md bg-neutral-900 border border-[#333333] text-[13px] text-[#e5e5e5] outline-none focus:ring-2 focus:ring-[#4ea8de]'
          />
        ) : (
          <p className='flex-1 min-w-40 flex items-center gap-1.5'>
            <Link2 size={14} className='shrink-0 text-[#4ea8de]' />
            <span className='min-w-0'>
              Shared graph{' '}
              <span className='text-neutral-100'>“{sharedName}”</span>, not
              saved yet
            </span>
          </p>
        )}
        <div className='flex items-center gap-2'>
          {naming ? (
            <>
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
              <button
                type='button'
                onClick={() => {
                  setError(null)
                  setNaming(true)
                }}
                className={PRIMARY_BUTTON}
              >
                Save to my graphs
              </button>
              <button type='button' onClick={onDiscard} className={BUTTON}>
                Discard
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className='mt-1 text-xs text-red-400'>{error}</p>}
    </div>
  )
}
