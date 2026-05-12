import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Trash, Search, Newspaper } from 'lucide-react'

import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import type {
  GraphDataCompact,
  NodeCompact,
  ClustersLegend,
} from '../lib/types'
import { buildAdjacency } from '../lib/graph'
import FilterBar from './FilterBar'
import { usePaperFilters } from '../hooks/usePaperFilters'

export default function MobilePapers({
  src = '/graph.json',
  onToggleView,
}: {
  src?: string
  onToggleView?: () => void
}) {
  const [data, setData] = useState<GraphDataCompact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)
  const searchBarRef = useRef<HTMLDivElement | null>(null)
  const [searchHeight, setSearchHeight] = useState(0)

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

  const lc = (s?: string | null) => (s ?? '').toLowerCase()

  // Scored search results (reuse weights from desktop component)
  const results = useMemo(() => {
    if (!data)
      return [] as Array<{ n: NodeCompact; score: number; deg: number }>
    const q = lc(query).trim()
    if (!q)
      return data.nodes
        .map((n) => ({ n, score: 0, deg: adj.get(n.id)?.length ?? 0 }))
        .sort((a, b) => b.deg - a.deg)

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

  const {
    filtered,
    activeCids,
    activeYear,
    activeDomains,
    clusterEntries,
    availableYears,
    availableDomains,
    hasActiveFilters,
    clearAllFilters,
    toggleCluster,
    toggleYear,
    toggleDomain,
  } = usePaperFilters(results, data)

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = 0
  }, [filtered])

  const selected = useMemo(
    () => (selectedId != null ? (byId.get(selectedId) ?? null) : null),
    [selectedId, byId],
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

  useLayoutEffect(() => {
    const el = searchBarRef.current
    if (!el) return
    const measure = () => setSearchHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (error) {
    return <div className='p-4 text-red-500'>{error}</div>
  }

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div
        ref={listRef}
        className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent scrollbar-hover:scrollbar-thumb-[#666]'
      >
        <div className='px-4 pt-4 pb-2'>
          <a
            target='_blank'
            href='https://github.com/ai-safety-graph/alignment-graph'
            className='flex items-center justify-center'
          >
            <img
              src='/ag-logo.svg'
              alt='Alignment Graph Logo'
              className='h-10 w-auto opacity-50 saturate-70'
            />
          </a>
        </div>
        <div
          ref={searchBarRef}
          className='sticky top-0 z-10 p-3 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 items-center flex gap-3'
        >
          <button
            onClick={onToggleView}
            className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
            aria-label='Show stats'
          >
            <Newspaper size={18} />
          </button>
          <div className='flex items-center gap-2 flex-1'>
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
          <div
            className='sticky bg-neutral-950/90 backdrop-blur border-b border-neutral-900'
            style={{ top: searchHeight }}
          >
            <FilterBar
              clusterEntries={clusterEntries}
              availableYears={availableYears}
              availableDomains={availableDomains}
              activeCids={activeCids}
              activeYear={activeYear}
              activeDomains={activeDomains}
              hasActiveFilters={hasActiveFilters}
              onToggleCluster={toggleCluster}
              onToggleYear={toggleYear}
              onToggleDomain={toggleDomain}
              onClearAll={clearAllFilters}
            />
          </div>
        )}

        {!data && (
          <div className='flex h-[60vh] items-center justify-center text-neutral-300'>
            Loading papers…
          </div>
        )}

        {data && filtered.length === 0 && (
          <div className='p-6 text-center text-neutral-400'>No matches.</div>
        )}

        <PaperList
          items={filtered}
          clusters={clusters}
          onSelectId={setSelectedId}
        />
      </div>

      {selected && (
        <div className='fixed inset-0 z-20 bg-black/70 flex items-center justify-center p-3'>
          <button
            aria-label='Close overlay'
            onClick={() => setSelectedId(null)}
            className='absolute inset-0'
          />
          <div className='relative z-10 w-full max-w-[720px] h-[92dvh] rounded-2xl shadow-2xl overflow-hidden'>
            <MobilePaperDetails
              paper={selected}
              clusters={clusters}
              neighbors={selectedNeighbors}
              onClose={() => setSelectedId(null)}
              onSelectPaper={(id) => setSelectedId(id)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
