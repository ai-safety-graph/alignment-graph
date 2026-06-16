import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trash, Search, Newspaper, Sparkles } from 'lucide-react'

import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import type { NodeCompact } from '../lib/types'
import type { SearchResult } from '../lib/api'
import FilterBar from './FilterBar'
import { useServerFilters } from '../hooks/useServerFilters'
import { useRelatedPapers } from '../hooks/useRelatedPapers'
import { useClusterCatalog } from '../hooks/useClusterCatalog'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePaperBrowser } from '../hooks/usePaperBrowser'
import { hasApi, searchPapers } from '../lib/api'

export default function MobilePapers() {
  const { clusters, availableDomains } = useClusterCatalog()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword')
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([])
  const [semanticLoading, setSemanticLoading] = useState(false)
  const apiAvailable = hasApi()

  const listRef = useRef<HTMLDivElement | null>(null)
  const searchBarRef = useRef<HTMLDivElement | null>(null)
  const [searchHeight, setSearchHeight] = useState(0)

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
  } = useServerFilters(clusters)

  // Keyword pagination is delegated to the shared browser; it pauses while
  // semantic search is active.
  const { papers: nodes, total, hasMore, error, loadMore } = usePaperBrowser({
    query: debouncedQuery,
    fromDate,
    activeCids,
    activeDomains,
    enabled: searchMode === 'keyword',
  })

  // Debounced semantic search
  useEffect(() => {
    if (searchMode !== 'semantic' || !query.trim()) {
      setSemanticResults([])
      return
    }
    const t = setTimeout(async () => {
      setSemanticLoading(true)
      try {
        const res = await searchPapers(query.trim(), { limit: 50 })
        setSemanticResults(res.results)
      } catch {
        setSemanticResults([])
      } finally {
        setSemanticLoading(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [query, searchMode])

  const byAid = useMemo(() => {
    const m = new Map<string, NodeCompact>()
    for (const n of nodes ?? []) m.set(n.aid, n)
    return m
  }, [nodes])

  const semanticByAid = useMemo(() => {
    const m = new Map<string, NodeCompact>()
    semanticResults.forEach((r, i) => m.set(r.aid, { ...r, id: -(i + 1) } as NodeCompact))
    return m
  }, [semanticResults])

  const effectiveByAid = useMemo(() => {
    if (searchMode !== 'semantic' || !semanticResults.length) return byAid
    return new Map([...byAid, ...semanticByAid])
  }, [searchMode, byAid, semanticByAid, semanticResults.length])

  const semanticItems = useMemo(
    () => semanticResults.map((r, i) => ({ n: { ...r, id: -(i + 1) } as NodeCompact })),
    [semanticResults],
  )

  const keywordItems = useMemo(
    () => (nodes ?? []).map((n) => ({ n })),
    [nodes],
  )

  const activeResults =
    searchMode === 'semantic' && query.trim() ? semanticItems : keywordItems

  const filtered = useMemo(() => {
    let res = activeResults
    if (activeCids.size > 0) res = res.filter(({ n }) => activeCids.has(n.cid))
    if (activeDomains.size > 0)
      res = res.filter(({ n }) => activeDomains.has(n.dm))
    return res
  }, [activeResults, activeCids, activeDomains])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = 0
  }, [filtered])

  const selected = useMemo(
    () => (selectedId != null ? (effectiveByAid.get(selectedId) ?? null) : null),
    [selectedId, effectiveByAid],
  )

  const { neighbors: selectedNeighbors, loading: neighborsLoading } =
    useRelatedPapers(selected?.aid ?? null)

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

  // Pagination only applies when showing keyword results
  const showingKeywordResults = searchMode === 'keyword' || !query.trim()
  const resetKey = `${searchMode}|${debouncedQuery}|${fromDate ?? ''}|${[...activeCids].sort()}|${[...activeDomains].sort()}`

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
          <Link
            to='/stats'
            className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
            aria-label='Show stats'
          >
            <Newspaper size={18} />
          </Link>
          <div className='flex items-center gap-2 flex-1'>
            <div className='relative flex-1'>
              {semanticLoading ? (
                <span className='absolute left-3 top-1/2 -translate-y-1/2 text-[#4ea8de] animate-spin text-xs'>
                  ⟳
                </span>
              ) : (
                <Search
                  className='absolute left-3 top-1/2 -translate-y-1/2'
                  size={16}
                />
              )}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  searchMode === 'semantic'
                    ? 'Semantic search…'
                    : 'Search papers on AI safety & alignment'
                }
                className='w-full pl-9 pr-10 py-2 rounded-xl bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
              />
            </div>
            {apiAvailable && (
              <button
                aria-label={
                  searchMode === 'semantic'
                    ? 'Switch to keyword search'
                    : 'Switch to semantic search'
                }
                onClick={() => {
                  setSearchMode((m) =>
                    m === 'keyword' ? 'semantic' : 'keyword',
                  )
                  setQuery('')
                }}
                className={`p-2 rounded-lg border transition-colors ${searchMode === 'semantic' ? 'bg-[#4ea8de]/20 border-[#4ea8de] text-[#4ea8de]' : 'border-[#333333] text-neutral-400 hover:text-neutral-200'}`}
                title={
                  searchMode === 'semantic'
                    ? 'Semantic search on (click to switch)'
                    : 'Keyword search (click for semantic)'
                }
              >
                <Sparkles size={16} />
              </button>
            )}
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

        {nodes && (
          <div
            className='sticky bg-neutral-950/90 backdrop-blur border-b border-neutral-900'
            style={{ top: searchHeight }}
          >
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

        {nodes && total > 0 && showingKeywordResults && (
          <div className='px-4 py-1.5 text-xs text-neutral-500'>
            Showing {nodes.length} of {total.toLocaleString()} papers
          </div>
        )}

        {!nodes && (
          <div className='flex h-[60vh] items-center justify-center text-neutral-300'>
            Loading papers…
          </div>
        )}

        {semanticLoading && (
          <div className='p-4 text-center text-[#4ea8de] text-sm'>
            Searching…
          </div>
        )}

        {!semanticLoading && nodes && filtered.length === 0 && (
          <div className='p-6 text-center text-neutral-400'>No matches.</div>
        )}

        <PaperList
          items={filtered}
          clusters={clusters}
          onSelectId={setSelectedId}
          resetKey={resetKey}
          hasMore={showingKeywordResults ? hasMore : false}
          onLoadMore={loadMore}
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
              neighborsLoading={neighborsLoading}
              navHistory={[]}
              onClose={() => setSelectedId(null)}
              onSelectPaper={setSelectedId}
              onNavigateTo={() => {}}
            />
          </div>
        </div>
      )}
    </div>
  )
}
