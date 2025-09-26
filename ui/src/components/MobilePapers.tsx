import { useEffect, useMemo, useState, useRef } from 'react'
import { Trash, Search } from 'lucide-react'

import PaperDetails from './PaperDetails'
import type {
  GraphDataCompact,
  NodeCompact,
  ClustersLegend,
} from '../lib/types'
import { cidToColor } from '../lib/colors'
import { buildAdjacency } from '../lib/graph'

/**
 * MobilePapers
 * A lightweight, touch-friendly alternative to the canvas graph for small screens.
 * - Fetches the same /graph.json
 * - Client-side fuzzy-ish search with scoring similar to ArxivGraph
 * - Tapping an item opens PaperDetails, with neighbors computed via adjacency
 */
export default function MobilePapers({
  src = '/graph.json',
}: {
  src?: string
}) {
  const [data, setData] = useState<GraphDataCompact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Fetch graph data
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as GraphDataCompact
        if (!alive) return
        setData(json)
      } catch (e: any) {
        if (!alive) return
        setError(`Failed to load graph: ${e?.message ?? String(e)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [src])

  // Build adjacency & byId maps for neighbor details
  const { byId, adj, clusters } = useMemo(() => {
    if (!data) {
      return {
        byId: new Map<number, NodeCompact>(),
        adj: new Map<number, Array<{ id: number; w: number }>>(),
        clusters: {} as ClustersLegend,
      }
    }
    const { byId, adj } = buildAdjacency(data.nodes, data.links)
    return { byId, adj, clusters: data.clusters }
  }, [data])

  // Cluster chips state
  const [activeCid, setActiveCid] = useState<number | null>(null)
  const clusterEntries = useMemo(
    () =>
      Object.entries(clusters) as Array<
        [string, { label?: string | null; size: number }]
      >,
    [clusters]
  )

  const lc = (s?: string | null) => (s ?? '').toLowerCase()

  // Scored search results (reuse weights from desktop component)
  const results = useMemo(() => {
    if (!data)
      return [] as Array<{ n: NodeCompact; score: number; deg: number }>
    const q = lc(query).trim()
    if (!q)
      return data.nodes
        .map((n) => ({ n, score: 0, deg: adj.get(n.id)?.length ?? 0 }))
        .sort((a, b) => b.deg - a.deg) // default: show higher degree papers first

    const terms = q.split(/\s+/).filter(Boolean)
    const weight = { title: 3, authors: 2, domain: 1.5, summary: 1 }

    function termCount(hay: string, term: string) {
      let c = 0
      let i = 0
      while ((i = hay.indexOf(term, i)) !== -1) {
        c++
        i += term.length
      }
      return c
    }

    function scoreNode(n: NodeCompact) {
      const title = lc(n.t)
      const authors = lc(n.au)
      const domain = lc(n.dm)
      const summary = lc(n.sm)

      let base = 0
      for (const t of terms) {
        base += termCount(title, t) * weight.title
        base += termCount(authors, t) * weight.authors
        base += termCount(domain, t) * weight.domain
        base += termCount(summary, t) * weight.summary
      }
      const matched = base > 0
      const deg = adj.get(n.id)?.length ?? 0
      const score = matched ? base + Math.min(deg, 50) * 0.02 : 0
      return { n, score, deg }
    }

    return data.nodes
      .map(scoreNode)
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200)
  }, [data, query, adj])

  // Apply cluster filter
  const filtered = useMemo(() => {
    if (activeCid == null) return results
    return results.filter(({ n }) => n.cid === activeCid)
  }, [results, activeCid])

  // Infinite scroll
  const [limit, setLimit] = useState(40)
  const slice = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setLimit(40) // reset when filter or query changes
  }, [activeCid, query])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setLimit((l) => Math.min(l + 40, filtered.length))
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [filtered.length])

  const selected = useMemo(
    () => (selectedId != null ? byId.get(selectedId) ?? null : null),
    [selectedId, byId]
  )

  const selectedNeighbors = useMemo(() => {
    if (selectedId == null) return []
    return (adj.get(selectedId) ?? [])
      .map(({ id, w }) => ({ n: byId.get(id)!, w }))
      .filter(({ n }) => !!n)
      .sort((a, b) => b.w - a.w)
  }, [selectedId, adj, byId])

  useEffect(() => {
    if (selected) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [selected])

  if (error) {
    return <div className='p-4 text-red-500'>{error}</div>
  }

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      {/* Top bar / search */}
      <div className='sticky top-0 z-10 p-3 bg-neutral-950/90 backdrop-blur border-b border-neutral-800'>
        <div className='flex items-center gap-2'>
          <div className='relative flex-1'>
            <Search
              className='absolute left-3 top-1/2 -translate-y-1/2'
              size={16}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search papers on AI safety & alignment'
              className='w-full pl-9 pr-10 py-2 rounded-xl bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
            />
          </div>
          {query && (
            <button
              aria-label='Clear'
              onClick={() => setQuery('')}
              className='p-2 rounded-lg text-neutral-400 hover:text-neutral-200'
            >
              <Trash size={18} />
            </button>
          )}
        </div>
      </div>

      {data && (
        <>
          {/* Cluster chips row */}
          <div className='flex gap-2 overflow-x-auto px-4 pt-3 pb-2 sticky top-[52px] bg-neutral-950/90 backdrop-blur border-b border-neutral-900 scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666]'>
            {clusterEntries.map(([cid, meta]) => (
              <button
                key={cid}
                onClick={() =>
                  setActiveCid((prev) => (prev === +cid ? null : +cid))
                }
                className={`px-3 py-1 rounded-full border text-sm whitespace-nowrap ${
                  activeCid === +cid
                    ? 'bg-neutral-800 border-neutral-500'
                    : 'border-neutral-700 hover:border-neutral-500'
                }`}
              >
                <span
                  className='inline-block w-2 h-2 mr-2 rounded-full mt-0.5 border border-[#333333]'
                  style={{ backgroundColor: cidToColor(Number(cid)) }}
                  aria-hidden
                />
                {(meta.label ?? `Cluster ${cid}`) + ' • ' + meta.size}
              </button>
            ))}
          </div>
        </>
      )}

      <div className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666]'>
        {!data && (
          <div className='p-4 text-sm text-neutral-400'>Loading papers…</div>
        )}

        {data && filtered.length === 0 && (
          <div className='p-6 text-center text-neutral-400'>No matches.</div>
        )}

        <ul className='divide-y divide-neutral-800 '>
          {slice.map(({ n, deg }) => (
            <li key={n.id}>
              <button
                onClick={() => setSelectedId(n.id)}
                className='w-full text-left px-4 py-3 active:bg-neutral-900'
              >
                <div className='text-[13px] text-neutral-400 truncate'>
                  {n.au}
                </div>
                <div className='mt-0.5 text-[15px] leading-snug'>{n.t}</div>
                <div className='mt-1 text-[12px] text-neutral-400 flex items-center gap-2'>
                  <div className='flex items-center gap-2 mb-0.5'>
                    <span
                      className='inline-block w-2 h-2 rounded-full border border-[#333333]'
                      style={{ background: cidToColor(n.cid) }}
                      aria-hidden
                    />
                    <span>
                      {clusters[String(n.cid)]?.label ?? `Cluster ${n.cid}`}
                    </span>
                    <span>•</span>
                    <span>{n.dm}</span>
                    <span>•</span>
                    <span>{deg} related</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {/* infinite scroll sentinel */}
        <div ref={sentinelRef} className='h-10' />
      </div>

      {/* Details overlay (simple full-screen sheet for mobile) */}
      {selected && (
        <div className='fixed inset-0 z-20 bg-black/70 flex items-center justify-center p-3'>
          {/* click background to close */}
          <button
            aria-label='Close overlay'
            onClick={() => setSelectedId(null)}
            className='absolute inset-0'
          />
          <div
            className='
        relative z-10
        w-full max-w-[720px]
        h-[min(92vh,900px)]
        rounded-2xl shadow-2xl
        overflow-hidden
      '
          >
            <PaperDetails
              paper={selected}
              clusters={clusters}
              neighbors={selectedNeighbors}
              onClose={() => setSelectedId(null)}
              onSelectPaper={(id) => setSelectedId(id)}
              showShortcutHints={false}
              variant='modal' // <— key line
            />
          </div>
        </div>
      )}
    </div>
  )
}
