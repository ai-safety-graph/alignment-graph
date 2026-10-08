import { CircleX } from 'lucide-react'
import SharePlusIcon from './icons/SharePlusIcon'
import ShareMinusIcon from './icons/ShareMinusIcon'
import { domainLabel } from '../lib/domain'
import type { NodeCompact } from '../lib/types'
import { usePaperSummary } from '../hooks/usePaperSummary'
import { useRef, useLayoutEffect } from 'react'
import type { RelatedPaper } from '../lib/api'
import TagChips from './TagChips'

interface Props {
  paper: NodeCompact
  related: RelatedPaper[]
  relatedLoading: boolean
  onClose: () => void
  onSelectPaper: (aid: string) => void
  onAddToSubgraph?: (aid: string) => void
  onRemoveFromSubgraph?: (aid: string) => void
  subgraphPaperIds?: Set<string>
  subgraphName?: string
}

export default function GraphPaperDetails({
  paper,
  related,
  relatedLoading,
  onClose,
  onSelectPaper,
  onAddToSubgraph,
  onRemoveFromSubgraph,
  subgraphPaperIds,
  subgraphName,
}: Props) {
  const isPaperInSubgraph = subgraphPaperIds?.has(paper.aid) ?? false
  const subgraphLabel = subgraphName ?? 'Subgraph'
  const urlKey = paper.ln || paper.aid
  const { data: lazy, loading, error } = usePaperSummary(urlKey)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const summaryText = lazy?.sm ?? paper.sm

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = 0
  }, [paper.id || urlKey])

  return (
    <aside
      ref={scrollerRef}
      className='fixed top-[72px] right-4 bottom-4 w-[440px] z-10 bg-neutral-950 backdrop-blur-md border border-[#333333] rounded-xl pb-3 px-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666]'
    >
      <div>
        <div className='py-3 sticky top-0 bg-neutral-950'>
          <div className='flex items-center justify-end mb-2'>
            <div className='flex items-center gap-1'>
              <kbd className='px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-600 text-[10px] font-mono text-neutral-300'>
                Esc
              </kbd>
              <button
                onClick={onClose}
                className='p-1.5 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200'
                aria-label='Close details'
              >
                <CircleX size={20} />
              </button>
            </div>
          </div>

          <h4 className='mt-1 mb-2 text-lg font-semibold leading-snug text-[#e5e5e5]'>
            {paper.t}
          </h4>
          <div className='flex items-center gap-2 mb-2 text-[13px] text-neutral-400'>
            <TagChips tags={paper.tags} />
          </div>

          {(onAddToSubgraph || onRemoveFromSubgraph) && (
            <button
              onClick={() =>
                isPaperInSubgraph
                  ? onRemoveFromSubgraph?.(paper.aid)
                  : onAddToSubgraph?.(paper.aid)
              }
              className='group flex items-center gap-1.5 max-w-full text-[13px] text-neutral-300 hover:text-white bg-neutral-950 border border-neutral-700 hover:border-neutral-500 rounded-md px-2.5 py-1 mb-2 cursor-pointer transition-colors'
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

        {loading && !summaryText && (
          <div className='flex items-center gap-2 text-[13px] italic text-neutral-400'>
            <span className='h-3 w-3 shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin' />
            Loading summary…
          </div>
        )}
        {error && !summaryText && (
          <div className='text-[13px] text-red-400'>
            Failed to load summary: {error}
          </div>
        )}
        {summaryText ? (
          <p className='whitespace-pre-wrap leading-relaxed text-neutral-300'>
            {summaryText}
          </p>
        ) : (
          !loading &&
          !error && (
            <div className='text-[13px] text-neutral-400'>
              No summary available.
            </div>
          )
        )}

        {paper.sm && (
          <>
            <div className='font-semibold my-2 text-neutral-200'>Summary</div>
            <p className='whitespace-pre-wrap leading-relaxed text-neutral-300'>
              {paper.sm}
            </p>
          </>
        )}

        <div className='font-semibold my-2 text-neutral-200'>
          Aligned Papers
        </div>

        {relatedLoading && (
          <div className='flex items-center gap-2 text-[13px] text-neutral-400 mb-1.5'>
            <span className='h-3 w-3 shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin' />
            Loading related papers…
          </div>
        )}

        {!relatedLoading && related.length === 0 && (
          <div className='text-[13px] text-neutral-400 mb-1.5'>
            No related papers found.
          </div>
        )}

        {!relatedLoading && related.length > 0 && (
          <>
            <div className='text-[13px] text-neutral-400 mb-1.5'>
              Showing {related.length} (sorted by similarity)
            </div>
            <ul className='list-none p-0 m-0'>
              {related.map((r) => {
                const inSubgraph = subgraphPaperIds?.has(r.aid) ?? false
                return (
                  <li
                    key={r.aid}
                    className='py-1.5 border-b border-neutral-800'
                  >
                    <div className='flex gap-2'>
                      <div className='flex-1 min-w-0'>
                        <a
                          onClick={(e) => {
                            e.preventDefault()
                            onSelectPaper(r.aid)
                          }}
                          href='#'
                          className='no-underline text-blue-400 hover:underline'
                          title={r.t}
                        >
                          {r.t.length > 80 ? r.t.slice(0, 77) + '…' : r.t}
                        </a>
                        <div className='text-[12px] text-neutral-500'>
                          <div>{r.au}</div>
                          <div className='flex items-center gap-2 mb-0.5 text-neutral-400'>
                            <TagChips tags={r.tags} />
                          </div>
                        </div>
                      </div>
                      {(onAddToSubgraph || onRemoveFromSubgraph) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (inSubgraph) onRemoveFromSubgraph?.(r.aid)
                            else onAddToSubgraph?.(r.aid)
                          }}
                          aria-label={
                            inSubgraph
                              ? `Remove from ${subgraphLabel}`
                              : `Add to ${subgraphLabel}`
                          }
                          className='group shrink-0 self-start p-1 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200 transition-colors'
                        >
                          {inSubgraph ? (
                            <ShareMinusIcon
                              size={14}
                              className='text-red-800 group-hover:text-red-500 transition-colors'
                            />
                          ) : (
                            <SharePlusIcon
                              size={14}
                              className='text-green-800 group-hover:text-green-500 transition-colors'
                            />
                          )}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
