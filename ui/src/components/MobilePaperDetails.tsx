import { CircleX } from 'lucide-react'
import { domainLabel } from '../lib/domain'
import type { NodeCompact } from '../lib/types'
import { useRef, useLayoutEffect } from 'react'
import TagChips from './TagChips'
import SharePlusIcon from './icons/SharePlusIcon'
import ShareMinusIcon from './icons/ShareMinusIcon'

type NeighborEntry = { n: NodeCompact; w: number }

interface Props {
  // Accepts any compact node; `sm` (summary) is optional and rendered when present.
  paper: NodeCompact
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

export default function MobilePaperDetails({
  paper,
  neighbors,
  neighborsLoading,
  onClose,
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
      ref={scrollerRef}
      className='relative w-full h-full bg-[#262626] backdrop-blur-md border border-[#333333] rounded-2xl pb-3 px-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent'
    >
      <div>
        <div className='py-3 sticky top-0 bg-[#262626]'>
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
                        className='hover:text-zinc-200 underline underline-offset-2 truncate max-w-[140px] text-left'
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
                  className='text-zinc-400 truncate max-w-[140px]'
                  title={paper.t}
                >
                  {paper.t.length > 35 ? paper.t.slice(0, 35) + '…' : paper.t}
                </span>
              </div>
            )}
          </div>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex items-center gap-2 mb-0.5 text-[13px] text-neutral-400'>
              <TagChips tags={paper.tags} />
            </div>
            <button
              onClick={onClose}
              className='p-1.5 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200'
              aria-label='Close details'
            >
              <CircleX size={20} />
            </button>
          </div>

          <h4 className='mt-1 mb-2 text-lg font-semibold leading-snug text-[#e5e5e5]'>
            {paper.t}
          </h4>
          {(onAddToSubgraph || onRemoveFromSubgraph) && (
            <div className='mb-2'>
              <button
                onClick={() =>
                  isPaperInSubgraph
                    ? onRemoveFromSubgraph?.(paper.aid)
                    : onAddToSubgraph?.(paper.aid)
                }
                className='group flex items-center gap-1.5 max-w-full text-[13px] text-neutral-300 hover:text-white bg-transparent border border-neutral-700 hover:border-neutral-500 rounded-md px-2.5 py-1 cursor-pointer transition-colors'
              >
                {isPaperInSubgraph ? (
                  <>
                    <span className='truncate'>Remove from {subgraphLabel}</span>
                    <ShareMinusIcon
                      size={14}
                      className='shrink-0 text-red-800 group-hover:text-red-500 transition-colors'
                    />
                  </>
                ) : (
                  <>
                    <span className='truncate'>Add to {subgraphLabel}</span>
                    <SharePlusIcon
                      size={14}
                      className='shrink-0 text-green-800 group-hover:text-green-500 transition-colors'
                    />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        <div className='text-[13px] mb-1.5'>
          <strong>Authors:</strong> {paper.au}
        </div>
        <div className='text-[13px] mb-1.5'>
          <strong>Published:</strong> {paper.pd || '—'}
        </div>
        <div className='text-[13px] mb-1.5'>
          <strong>arXiv domain:</strong> {domainLabel(paper.dm)}
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
              {neighbors.map(({ n }) => (
                <li key={n.aid} className='py-1.5 border-b border-neutral-800'>
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
                  </div>
                  <div className='text-[12px] text-neutral-500'>
                    <div>{n.au}</div>
                    <div className='flex items-center gap-2 mb-0.5 text-neutral-400'>
                      <TagChips tags={n.tags} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
