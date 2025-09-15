import { cidToColor } from '../lib/colors'
import type { ClustersLegend, NodeCompact } from '../lib/types'

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s

export default function SearchResultsOverlay({
  results,
  onSelect,
  clusters,
}: {
  results: Array<{ n: NodeCompact; score: number; deg: number }>
  onSelect: (id: number) => void
  clusters: ClustersLegend
}) {
  if (!results?.length) return null

  return (
    <aside className='scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666] fixed top-[72px] left-4 bottom-[208px] w-[360px] z-10 bg-[#262626] backdrop-blur-md border border-[#333333] rounded-xl p-3 overflow-auto text-[#e5e5e5]'>
      <div className='flex items-center mb-2'>
        <h3 className='m-0 flex-1 text-base font-semibold text-[#f5f5f5]'>
          Search Results
        </h3>
        <span className='text-[12px] text-neutral-400'>{results.length}</span>
      </div>

      <ul className='list-none p-0 m-0'>
        {results.map(({ n }) => (
          <li key={n.id} className='py-2 border-b border-neutral-800'>
            <div className='flex items-start gap-2'>
              <div className='flex-1 min-w-0'>
                <a
                  href='#'
                  onClick={(e) => {
                    e.preventDefault()
                    onSelect(n.id)
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
                    {n.dm}
                  </span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
