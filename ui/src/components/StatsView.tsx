import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { ArrowLeft, Search, Trash } from 'lucide-react'
import type {
  GraphDataCompact,
  NodeCompact,
  ClustersLegend,
} from '../lib/types'
import { buildAdjacency } from '../lib/graph'
import PaperDetails from './PaperDetails'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import { usePaperFilters } from '../hooks/usePaperFilters'

export default function StatsView({
  src = '/graph.json',
  onToggleView,
}: {
  src?: string
  onToggleView: () => void
}) {
  const [data, setData] = useState<GraphDataCompact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)

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
    activeMonth,
    activeDomains,
    clusterEntries,
    availableYears,
    availableMonths,
    availableDomains,
    hasActiveFilters,
    clearAllFilters,
    toggleCluster,
    toggleYear,
    toggleMonth,
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

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      {/* Top: full-width search bar, centered */}
      <div className='shrink-0 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur px-3 py-3 flex items-center gap-3'>
        <button
          onClick={onToggleView}
          className='shrink-0 text-neutral-400 hover:text-neutral-200 cursor-pointer'
          aria-label='Back to graph'
        >
          <ArrowLeft size={16} />
        </button>
        <div className='flex-1 flex justify-center'>
          <div className='relative w-full max-w-xl flex items-center gap-2'>
            <div className='relative flex-1'>
              <Search
                className='absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400'
                size={16}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search papers on AI safety & alignment'
                className='w-full pl-9 pr-3 py-2 rounded-xl bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
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
        {/* Spacer balances the back arrow so the input stays visually centred */}
        <div className='shrink-0 w-6' />
      </div>

      {/* Body */}
      <div className='flex flex-row flex-1 overflow-hidden'>
        <div className='flex flex-col flex-1 overflow-hidden min-w-0'>
          {/* Filters */}
          {data && (
            <div className='shrink-0 border-b border-neutral-900'>
              <FilterBar
                clusterEntries={clusterEntries}
                availableYears={availableYears}
                availableMonths={availableMonths}
                availableDomains={availableDomains}
                activeCids={activeCids}
                activeYear={activeYear}
                activeMonth={activeMonth}
                activeDomains={activeDomains}
                hasActiveFilters={hasActiveFilters}
                onToggleCluster={toggleCluster}
                onToggleYear={toggleYear}
                onToggleMonth={toggleMonth}
                onToggleDomain={toggleDomain}
                onClearAll={clearAllFilters}
              />
            </div>
          )}

          {/* Paper list */}
          <div
            ref={listRef}
            className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'
          >
            {error && <p className='p-4 text-red-400'>{error}</p>}

            {!data && (
              <div className='flex h-[60vh] items-center justify-center text-neutral-400'>
                Loading…
              </div>
            )}

            {data && filtered.length === 0 && (
              <div className='p-6 text-center text-neutral-400'>
                No matches.
              </div>
            )}

            <PaperList
              items={filtered}
              clusters={clusters}
              onSelectId={setSelectedId}
              enableHover
            />
          </div>
        </div>

        {selected && (
          <div className='w-1/2 border-l border-neutral-800 overflow-y-auto'>
            <PaperDetails
              paper={selected}
              clusters={clusters}
              neighbors={selectedNeighbors}
              onClose={() => setSelectedId(null)}
              onSelectPaper={(id) => setSelectedId(id)}
              showShortcutHints={false}
              variant='embedded'
            />
          </div>
        )}
      </div>
    </div>
  )
}
