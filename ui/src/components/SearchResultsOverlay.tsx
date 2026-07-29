import SharePlusIcon from './icons/SharePlusIcon'
import ShareMinusIcon from './icons/ShareMinusIcon'
import { cidToColor } from '../lib/colors'
import { domainLabel } from '../lib/domain'
import type { ClustersLegend, NodeCompact } from '../lib/types'

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s

export default function SearchResultsOverlay({
  results,
  onSelect,
  clusters,
  isLoading,
  onAddToSubgraph,
  onRemoveFromSubgraph,
  subgraphPaperIds,
  subgraphName,
}: {
  results: Array<{ n: NodeCompact; score: number; deg: number }>
  onSelect: (aid: string) => void
  clusters: ClustersLegend
  isLoading?: boolean
  onAddToSubgraph?: (aid: string) => void
  onRemoveFromSubgraph?: (aid: string) => void
  subgraphPaperIds?: Set<string>
  subgraphName?: string
}) {
  const subgraphLabel = subgraphName ?? 'Subgraph'
  if (!isLoading && !results?.length) return null

  return (
    <aside className='scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666] w-[360px] h-full bg-[#262626] backdrop-blur-md border border-[#333333] rounded-xl p-3 overflow-auto text-[#e5e5e5]'>
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
                  <div className='text-[12px] text-neutral-400 flex items-center gap-2 mb-0.5'>
                    <span
                      className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                      style={{ background: cidToColor(n.cid) }}
                      aria-hidden
                    />
                    <span>
                      {clusters[String(n.cid)]?.label ?? `Cluster ${n.cid}`} •{' '}
                      {domainLabel(n.dm)}
                    </span>
                  </div>
                </div>
                {(onAddToSubgraph || onRemoveFromSubgraph) && (
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      if (inSubgraph) onRemoveFromSubgraph?.(n.aid)
                      else onAddToSubgraph?.(n.aid)
                    }}
                    aria-label={inSubgraph ? `Remove from ${subgraphLabel}` : `Add to ${subgraphLabel}`}
                    className='group p-1.5 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200 shrink-0'
                  >
                    {inSubgraph ? <ShareMinusIcon size={14} className='text-red-800 group-hover:text-red-500 transition-colors' /> : <SharePlusIcon size={14} className='text-green-800 group-hover:text-green-500 transition-colors' />}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
