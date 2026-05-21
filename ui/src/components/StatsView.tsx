import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Share2, Search, Trash } from 'lucide-react'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import StatsPaperDetails from './StatsPaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import { useApiFilters } from '../hooks/useApiFilters'
import { useRelatedPapers } from '../hooks/useRelatedPapers'

export default function StatsView({
  onToggleView,
}: {
  onToggleView: () => void
}) {
  const [nodes, setNodes] = useState<NodeCompact[] | null>(null)
  const [clusters, setClusters] = useState<ClustersLegend>({})
  const [availableDomains, setAvailableDomains] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)

  const listRef = useRef<HTMLDivElement | null>(null)
  const hasLoadedRef = useRef(false)
  const isLoadingMoreRef = useRef(false)
  const loadParamsRef = useRef({ query: '', fromDate: undefined as string | undefined, page: 1, hasMore: false })

  // Fetch clusters + available domains once on mount
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { fetchClusters, fetchStats } = await import('../lib/api')
        const [allClusters, stats] = await Promise.all([fetchClusters(), fetchStats()])
        if (!alive) return
        setClusters(allClusters)
        setAvailableDomains(Object.keys(stats.domains).filter(Boolean).sort())
      } catch {}
    })()
    return () => { alive = false }
  }, [])

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const {
    fromDate,
    datePreset,
    setDatePreset,
    activeCids,
    activeDomains,
    clusterEntries,
    hasActiveFilters,
    clearAllFilters,
    toggleCluster,
    toggleDomain,
  } = useApiFilters(clusters)

  // Keep loadParamsRef in sync so loadMore always reads fresh values
  loadParamsRef.current = { query: debouncedQuery, fromDate, page, hasMore }

  // Reload papers whenever debounced query or date filter changes
  useEffect(() => {
    let alive = true
    isLoadingMoreRef.current = false
    ;(async () => {
      try {
        const { fetchPapers } = await import('../lib/api')
        const result = await fetchPapers({
          q: debouncedQuery || undefined,
          from: fromDate,
          limit: 50,
        })
        if (!alive) return
        setNodes(result.items.map((item, i) => ({ ...item, id: i })))
        setTotal(result.total)
        setPage(1)
        setHasMore(result.items.length < result.total)
        hasLoadedRef.current = true
      } catch (e: any) {
        if (!alive) return
        if (!hasLoadedRef.current) setError(`Failed to load papers: ${e?.message ?? String(e)}`)
      }
    })()
    return () => { alive = false }
  }, [debouncedQuery, fromDate])

  async function loadMore() {
    const { query, fromDate: fd, page: p, hasMore: hm } = loadParamsRef.current
    if (!hm || isLoadingMoreRef.current) return
    isLoadingMoreRef.current = true
    try {
      const { fetchPapers } = await import('../lib/api')
      const result = await fetchPapers({ q: query || undefined, from: fd, limit: 50, page: p + 1 })
      setNodes((prev) => {
        const prevLen = prev?.length ?? 0
        return [...(prev ?? []), ...result.items.map((item, i) => ({ ...item, id: prevLen + i }))]
      })
      setPage(p + 1)
      setTotal(result.total)
      setHasMore((p + 1) * 50 < result.total)
    } catch {}
    isLoadingMoreRef.current = false
  }

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

  const filtered = useMemo(() => {
    let res = nodes ?? []
    if (activeCids.size > 0) res = res.filter((n) => activeCids.has(n.cid))
    if (activeDomains.size > 0) res = res.filter((n) => activeDomains.has(n.dm))
    return res.map((n) => ({ n, deg: 0 }))
  }, [nodes, activeCids, activeDomains])

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
                availableDomains={availableDomains}
                activeCids={activeCids}
                activeDomains={activeDomains}
                datePreset={datePreset}
                hasActiveFilters={hasActiveFilters}
                onToggleCluster={toggleCluster}
                onToggleDomain={toggleDomain}
                onSetDatePreset={setDatePreset}
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
              resetKey={`${debouncedQuery}|${fromDate ?? ''}`}
              hasMore={hasMore}
              onLoadMore={loadMore}
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
