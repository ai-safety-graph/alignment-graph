import type { NodeCompact } from '../lib/types'
import PinToggle from './PinToggle'
import TagChips from './TagChips'
import VenueBadge from './VenueBadge'

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s

export default function SearchResultsOverlay({
  results,
  onSelect,
  isLoading,
  onAddToSubgraph,
  onRemoveFromSubgraph,
  subgraphPaperIds,
  subgraphName,
  subgraphFull,
}: {
  results: Array<{ n: NodeCompact; score: number; deg: number }>
  onSelect: (aid: string) => void
  isLoading?: boolean
  onAddToSubgraph?: (aid: string) => void
  onRemoveFromSubgraph?: (aid: string) => void
  subgraphPaperIds?: Set<string>
  subgraphName?: string
  subgraphFull?: boolean
}) {
  if (!isLoading && !results?.length) return null

  return (
    <aside className='scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666] w-[360px] h-full bg-neutral-950 backdrop-blur-md border border-[#333333] rounded-xl p-3 overflow-auto text-[#e5e5e5]'>
      <div className='flex items-center mb-2'>
        <h3 className='m-0 flex-1 text-base font-semibold text-[#f5f5f5]'>
          Search Results
        </h3>
        <span className='text-[12px] text-neutral-400'>{results.length}</span>
      </div>

      {isLoading && results.length === 0 && (
        <div className='flex items-center gap-2 text-neutral-400 text-sm p-2'>
          <span className='h-3 w-3 shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin' />
          Searching…
        </div>
      )}

      <ul className='list-none p-0 m-0'>
        {results.map(({ n }) => {
          const inSubgraph = subgraphPaperIds?.has(n.aid) ?? false
          return (
            <li key={n.aid} className='py-2 border-b border-neutral-800'>
              <div className='flex items-start gap-2'>
                <div className='flex-1 min-w-0'>
                  {n.pr && (
                    <div className='mb-1 flex'>
                      <VenueBadge pr={n.pr} vn={n.vn} />
                    </div>
                  )}
                  <a
                    href='#'
                    onClick={(e) => {
                      e.preventDefault()
                      onSelect(n.aid)
                    }}
                    className='no-underline text-blue-400 hover:underline block'
                    title={n.t}
                  >
                    {truncate(n.t, 90)}
                  </a>
                  <div className='text-[12px] text-neutral-500 truncate'>
                    {n.au}
                  </div>
                  <div className='text-[12px] text-neutral-400 flex flex-wrap items-center gap-x-2 gap-y-1 mb-0.5'>
                    <TagChips tags={n.tags} max={2} />
                  </div>
                </div>
                {(onAddToSubgraph || onRemoveFromSubgraph) && (
                  <PinToggle
                    variant='icon'
                    className='p-1.5'
                    pinned={inSubgraph}
                    full={subgraphFull}
                    graphName={subgraphName}
                    onPin={() => onAddToSubgraph?.(n.aid)}
                    onUnpin={() => onRemoveFromSubgraph?.(n.aid)}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
