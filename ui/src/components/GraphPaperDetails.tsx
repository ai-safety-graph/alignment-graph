import { CircleX, Plus, Minus } from 'lucide-react'
import { cidToColor } from '../lib/colors'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import { usePaperSummary } from '../hooks/usePaperSummary'
import { useRef, useLayoutEffect } from 'react'
import type { RelatedPaper } from '../lib/api'

interface Props {
  paper: NodeCompact
  clusters: ClustersLegend
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
  clusters,
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
  const urlKey = paper.ln || (paper as any).aid
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
      ref={scrollerRef as any}
      className='fixed top-[72px] right-4 bottom-4 w-[440px] z-10 bg-[#262626] backdrop-blur-md border border-[#333333] rounded-xl pb-3 px-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666]'
    >
      <div>
        <div className='py-3 sticky top-0 bg-[#262626]'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex items-center gap-2 mb-0.5'>
              <span
                className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                style={{ background: cidToColor(paper.cid) }}
                aria-hidden
              />
              <span className='text-[13px] text-neutral-400'>
                {clusters[String(paper.cid)]?.label ?? `Cluster ${paper.cid}`} •{' '}
                {paper.dm}
              </span>
            </div>
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

          <button
            onClick={() =>
              isPaperInSubgraph
                ? onRemoveFromSubgraph?.(paper.aid)
                : onAddToSubgraph?.(paper.aid)
            }
            className='flex items-center gap-1.5 text-[13px] text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded-md px-2.5 py-1 mb-2'
          >
            {isPaperInSubgraph ? (
              <>
                Remove from {subgraphLabel}
                <Minus size={14} />
              </>
            ) : (
              <>
                Add to {subgraphLabel}
                <Plus size={14} />
              </>
            )}
          </button>
        </div>
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

        {loading && !summaryText && (
          <div className='text-[13px] italic text-neutral-400'>
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
          <div className='text-[13px] italic text-neutral-400 mb-1.5'>
            Loading…
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
              {related.map((r) => (
                <li key={r.aid} className='py-1.5 border-b border-neutral-800'>
                  <div className='flex justify-between gap-2'>
                    <a
                      onClick={(e) => {
                        e.preventDefault()
                        onSelectPaper(r.aid)
                      }}
                      href='#'
                      className='no-underline text-blue-400 hover:underline flex-1'
                      title={r.t}
                    >
                      {r.t.length > 80 ? r.t.slice(0, 77) + '…' : r.t}
                    </a>
                  </div>
                  <div className='text-[12px] text-neutral-500'>
                    <div>{r.au}</div>
                    <div className='flex items-center gap-2 mb-0.5'>
                      <span
                        className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                        style={{ background: cidToColor(r.cid) }}
                        aria-hidden
                      />
                      <span className='text-neutral-400'>
                        {clusters[String(r.cid)]?.label ?? `Cluster ${r.cid}`} •{' '}
                        {r.dm}
                      </span>
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
