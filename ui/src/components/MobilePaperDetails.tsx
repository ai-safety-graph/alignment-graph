import { CircleX } from 'lucide-react'
import { cidToColor } from '../lib/colors'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import { usePaperSummary } from '../hooks/usePaperSummary'
import { useRef, useLayoutEffect } from 'react'

type NeighborEntry = { n: NodeCompact; w: number }

interface Props {
  paper: NodeCompact
  clusters: ClustersLegend
  neighbors: NeighborEntry[]
  onClose: () => void
  onSelectPaper: (aid: string) => void
  navHistory: { aid: string; title: string }[]
  onNavigateTo: (aid: string, historyIndex: number) => void
}

export default function MobilePaperDetails({
  paper,
  clusters,
  neighbors,
  onClose,
  onSelectPaper,
  navHistory,
  onNavigateTo,
}: Props) {
  const urlKey = paper.ln || (paper as any).aid
  const { data: lazy, loading, error } = usePaperSummary(urlKey)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const summaryText = lazy?.sm ?? paper.sm

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = 0
  }, [paper.aid])

  return (
    <aside
      ref={scrollerRef as any}
      className='relative w-full h-full bg-[#262626] backdrop-blur-md border border-[#333333] rounded-2xl pb-3 px-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'
    >
      <div>
        <div className='py-3 sticky top-0 bg-[#262626]'>
          <div className='min-h-[1.25rem] pb-2'>
          {navHistory.length > 0 && (
            <div className='flex items-center gap-1 text-xs text-zinc-500 flex-wrap'>
              {navHistory.slice(-3).map((entry, i) => {
                const absoluteIndex = navHistory.length - Math.min(3, navHistory.length) + i
                return (
                  <span key={entry.aid} className='flex items-center gap-1'>
                    <button
                      onClick={() => onNavigateTo(entry.aid, absoluteIndex)}
                      className='hover:text-zinc-200 underline underline-offset-2 truncate max-w-[140px] text-left'
                      title={entry.title}
                    >
                      {entry.title.length > 35 ? entry.title.slice(0, 35) + '…' : entry.title}
                    </button>
                    <span className='text-zinc-700'>›</span>
                  </span>
                )
              })}
              <span className='text-zinc-400 truncate max-w-[140px]' title={paper.t}>
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
                {clusters[String(paper.cid)]?.label ?? `Cluster ${paper.cid}`} •{' '}
                {paper.dm}
              </span>
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
                <div className='flex items-center gap-2 mb-0.5'>
                  <span
                    className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                    style={{ background: cidToColor(n.cid) }}
                    aria-hidden
                  />
                  <span className='text-neutral-400'>
                    {clusters[String(n.cid)]?.label ?? `Cluster ${n.cid}`} •{' '}
                    {n.dm}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
