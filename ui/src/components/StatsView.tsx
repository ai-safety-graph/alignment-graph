import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Share2, Search, Trash } from 'lucide-react'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import StatsPaperDetails from './StatsPaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import { usePaperFilters } from '../hooks/usePaperFilters'
import { useRelatedPapers } from '../hooks/useRelatedPapers'

export default function StatsView({
  onToggleView,
}: {
  onToggleView: () => void
}) {
  const [nodes, setNodes] = useState<NodeCompact[] | null>(null)
  const [clusters, setClusters] = useState<ClustersLegend>({})
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { fetchAllPapers, fetchClusters } = await import('../lib/api')
        const [allNodes, allClusters] = await Promise.all([fetchAllPapers(), fetchClusters()])
        if (!alive) return
        setNodes(allNodes)
        setClusters(allClusters)
      } catch (e: any) {
        if (!alive) return
        setError(`Failed to load papers: ${e?.message ?? String(e)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const byId = useMemo(() => {
    const m = new Map<number, NodeCompact>()
    for (const n of nodes ?? []) m.set(n.id, n)
    return m
  }, [nodes])

  const aidToId = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of nodes ?? []) m.set(n.aid, n.id)
    return m
  }, [nodes])

  const adj = useMemo(() => new Map<number, Array<{ id: number; w: number }>>(), [])

  const lc = (s?: string | null) => (s ?? '').toLowerCase()

  const results = useMemo(() => {
    if (!nodes)
      return [] as Array<{ n: NodeCompact; score: number; deg: number }>
    const q = lc(query).trim()
    if (!q)
      return nodes
        .map((n) => ({ n, score: 0, deg: 0 }))
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

    return nodes
      .map(scoreNode)
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200)
  }, [nodes, query])

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
  } = usePaperFilters(results, nodes, clusters)

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = 0
  }, [filtered])

  const selected = useMemo(
    () => (selectedId != null ? (byId.get(selectedId) ?? null) : null),
    [selectedId, byId],
  )

  const selectedNeighbors = useRelatedPapers(selected, aidToId)

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
          className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
          aria-label='Back to graph'
        >
          <Share2 size={18} />
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
          {nodes && (
            <div className='shrink-0 border-b border-neutral-900'>
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

          {/* Paper list */}
          <div
            ref={listRef}
            className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'
          >
            {error && <p className='p-4 text-red-400'>{error}</p>}

            {!nodes && (
              <div className='flex h-[60vh] items-center justify-center text-neutral-400'>
                Loading…
              </div>
            )}

            {nodes && filtered.length === 0 && (
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

        <div className='hidden md:block w-1/2 border-l border-neutral-800 overflow-y-auto'>
          {selected ? (
            <StatsPaperDetails
              paper={selected}
              clusters={clusters}
              neighbors={selectedNeighbors}
              onClose={() => setSelectedId(null)}
              onSelectPaper={(id) => setSelectedId(id)}
            />
          ) : (
            <div className='flex h-full items-center justify-center text-neutral-500 text-sm'>
              Select a paper to load details
            </div>
          )}
        </div>
      </div>
      {selected && (
        <div className='md:hidden fixed inset-0 z-20 bg-black/70 flex items-center justify-center p-3'>
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
