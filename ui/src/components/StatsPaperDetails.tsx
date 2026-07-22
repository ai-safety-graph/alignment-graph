import { cidToColor } from '../lib/colors'
import { domainLabel } from '../lib/domain'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import type { PaperDetail } from '../lib/api'
import SharePlusIcon from './icons/SharePlusIcon'
import ShareMinusIcon from './icons/ShareMinusIcon'
import ClusterLabel from './ClusterLabel'
import { useRef, useLayoutEffect } from 'react'

type NeighborEntry = { n: NodeCompact; w: number }

interface Props {
  paper: PaperDetail
  clusters: ClustersLegend
  clustersLoading?: boolean
  neighbors: NeighborEntry[]
  neighborsLoading: boolean
  onClose: () => void
  onSelectPaper: (aid: string) => void
  navHistory: { aid: string; title: string }[]
  onNavigateTo: (aid: string, historyIndex: number) => void
  onAddToSubgraph?: (aid: string) => void
  onRemoveFromSubgraph?: (aid: string) => void
  subgraphPaperIds?: Set<string>
  subgraphName?: string
}

export default function StatsPaperDetails({
  paper,
  clusters,
  clustersLoading = false,
  neighbors,
  neighborsLoading,
  onSelectPaper,
  navHistory,
  onNavigateTo,
  onAddToSubgraph,
  onRemoveFromSubgraph,
  subgraphPaperIds,
  subgraphName,
}: Props) {
  const isPaperInSubgraph = subgraphPaperIds?.has(paper.aid) ?? false
  const subgraphLabel = subgraphName ?? 'Subgraph'
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const summaryText = paper.sm

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = 0
  }, [paper.aid])

  return (
    <aside
      ref={scrollerRef as any}
      className='relative w-full h-full bg-neutral-950 backdrop-blur-md pb-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'
    >
      <div>
        <div className='py-3 sticky top-0 bg-neutral-950 px-3 lg:px-6'>
          <div className='min-h-[1.25rem] pb-2'>
            {navHistory.length > 0 && (
              <div className='flex items-center gap-1 text-xs text-zinc-500 flex-wrap'>
                {navHistory.slice(-3).map((entry, i) => {
                  const absoluteIndex =
                    navHistory.length - Math.min(3, navHistory.length) + i
                  return (
                    <span key={entry.aid} className='flex items-center gap-1'>
                      <button
                        onClick={() => onNavigateTo(entry.aid, absoluteIndex)}
                        className='hover:text-zinc-200 underline underline-offset-2 truncate max-w-[160px] text-left'
                        title={entry.title}
                      >
                        {entry.title.length > 35
                          ? entry.title.slice(0, 35) + '…'
                          : entry.title}
                      </button>
                      <span className='text-zinc-700'>›</span>
                    </span>
                  )
                })}
                <span
                  className='text-zinc-400 truncate max-w-[160px]'
                  title={paper.t}
                >
                  {paper.t.length > 35 ? paper.t.slice(0, 35) + '…' : paper.t}
                </span>
              </div>
            )}
          </div>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex items-center gap-2 mb-0.5'>
              <span
                className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                style={{ background: cidToColor(paper.cid) }}
                aria-hidden
              />
              <span className='text-[13px] text-neutral-400'>
                <ClusterLabel
                  cid={paper.cid}
                  clusters={clusters}
                  isLoading={clustersLoading}
                />{' '}
                • {domainLabel(paper.dm)}
              </span>
            </div>

            {(onAddToSubgraph || onRemoveFromSubgraph) && (
              <button
                onClick={() =>
                  isPaperInSubgraph
                    ? onRemoveFromSubgraph?.(paper.aid)
                    : onAddToSubgraph?.(paper.aid)
                }
                className='group flex items-center gap-1.5 text-[13px] text-neutral-300 hover:text-white bg-[#2a2a2a] border border-neutral-700 hover:border-neutral-500 rounded-md px-2.5 py-1 cursor-pointer transition-colors'
              >
                {isPaperInSubgraph ? (
                  <>
                    Remove from {subgraphLabel}
                    <ShareMinusIcon size={14} className='text-red-800 group-hover:text-red-500 transition-colors' />
                  </>
                ) : (
                  <>
                    Add to {subgraphLabel}
                    <SharePlusIcon size={14} className='text-green-800 group-hover:text-green-500 transition-colors' />
                  </>
                )}
              </button>
            )}
          </div>

          <h4 className='mt-1 mb-2 text-lg font-semibold leading-snug text-[#e5e5e5]'>
            {paper.t}
          </h4>
        </div>
        <div className='px-3 lg:px-6'>
          <div className='text-[13px] mb-1.5'>
            <strong>Authors:</strong> {paper.au}
          </div>
          <div className='text-[13px] mb-1.5'>
            <strong>Published:</strong> {paper.pd || '—'}
          </div>

          <div className='flex gap-2 mb-3'>
            <a
              href={paper.ln}
              target='_blank'
              rel='noreferrer'
              className='text-[13px] text-[#4ea8de] hover:text-[#60a5fa] hover:underline'
            >
              View on arXiv ↗
            </a>
          </div>

          {summaryText ? (
            <p className='whitespace-pre-wrap leading-relaxed text-neutral-300'>
              {summaryText}
            </p>
          ) : (
            <div className='text-[13px] text-neutral-400'>
              No summary available.
            </div>
          )}

          <div className='font-semibold my-2 text-neutral-200'>
            Aligned Papers
          </div>

          {neighborsLoading ? (
            <div className='space-y-3 animate-pulse'>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className='py-1.5 border-b border-neutral-800 space-y-1.5'
                >
                  <div className='h-3 bg-neutral-800 rounded w-5/6' />
                  <div className='h-3 bg-neutral-800 rounded w-3/6' />
                  <div className='h-3 bg-neutral-800 rounded w-2/6' />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className='text-[13px] text-neutral-400 mb-1.5'>
                Showing {neighbors.length} (sorted by similarity)
              </div>

              <ul className='list-none p-0 m-0'>
                {neighbors.map(({ n }) => {
                  const inSubgraph = subgraphPaperIds?.has(n.aid) ?? false
                  return (
                  <li
                    key={n.aid}
                    className='py-1.5 border-b border-neutral-800'
                  >
                    <div className='flex justify-between gap-2'>
                      <a
                        onClick={(e) => {
                          e.preventDefault()
                          onSelectPaper(n.aid)
                        }}
                        href='#'
                        className='no-underline text-blue-400 hover:underline flex-1'
                        title={n.t}
                      >
                        {n.t.length > 80 ? n.t.slice(0, 77) + '…' : n.t}
                      </a>
                      {(onAddToSubgraph || onRemoveFromSubgraph) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (inSubgraph) onRemoveFromSubgraph?.(n.aid)
                            else onAddToSubgraph?.(n.aid)
                          }}
                          aria-label={
                            inSubgraph
                              ? `Remove from ${subgraphLabel}`
                              : `Add to ${subgraphLabel}`
                          }
                          className='group shrink-0 p-1 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200 transition-colors'
                        >
                          {inSubgraph ? <ShareMinusIcon size={14} className='text-red-800 group-hover:text-red-500 transition-colors' /> : <SharePlusIcon size={14} className='text-green-800 group-hover:text-green-500 transition-colors' />}
                        </button>
                      )}
                    </div>
                    <div className='text-[12px] text-neutral-500'>
                      <div>{n.au}</div>
                      <div className='flex items-center gap-2 mb-0.5'>
                        <span
                          className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                          style={{ background: cidToColor(n.cid) }}
                          aria-hidden
                        />
                        <span className='text-neutral-400'>
                          <ClusterLabel
                            cid={n.cid}
                            clusters={clusters}
                            isLoading={clustersLoading}
                          />{' '}
                          • {domainLabel(n.dm)}
                        </span>
                      </div>
                    </div>
                  </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
