import { CircleX } from 'lucide-react'
import { cidToColor } from '../lib/colors'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import { usePaperSummary } from '../hooks/usePaperSummary'

type NeighborEntry = { n: NodeCompact; w: number }

interface PaperDetailsProps {
  paper: NodeCompact
  clusters: ClustersLegend
  neighbors: NeighborEntry[]
  onClose: () => void
  onSelectPaper: (id: number) => void
}

export default function PaperDetails({
  paper,
  clusters,
  neighbors,
  onClose,
  onSelectPaper,
}: PaperDetailsProps) {
  const urlKey = paper.ln || (paper as any).aid
  const { data: lazy, loading, error } = usePaperSummary(urlKey)

  const summaryText = lazy?.sm ?? paper.sm
  return (
    <aside className='fixed top-[72px] right-4 bottom-4 w-[440px] z-10 bg-[#262626] backdrop-blur-md border border-[#333333] rounded-xl p-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666]'>
      <div>
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
        {/* <div className='font-semibold my-2 text-neutral-200'>Summary</div> */}
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
          {neighbors.map(({ n /*w*/ }) => (
            <li key={n.id} className='py-1.5 border-b border-neutral-800'>
              <div className='flex justify-between gap-2'>
                <a
                  onClick={(e) => {
                    e.preventDefault()
                    onSelectPaper(n.id)
                  }}
                  href='#'
                  className='no-underline text-blue-400 hover:underline flex-1'
                  title={n.t}
                >
                  {n.t.length > 80 ? n.t.slice(0, 77) + '…' : n.t}
                </a>
                {/* <span className='text-neutral-300 tabular-nums'>
                  {w.toFixed(3)}
                </span> */}
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
