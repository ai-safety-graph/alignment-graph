import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Share2, Search, Trash, Plus, Check, X, Eye, EyeOff, ExternalLink } from 'lucide-react'
import StatsPaperDetails from './StatsPaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import Dropdown from './Dropdown'
import {
  createSavedGraph,
  listSavedGraphs,
  updateSavedGraph,
  type SavedGraph,
} from '../lib/storage'
import type { NodeCompact } from '../lib/types'
import { useServerFilters } from '../hooks/useServerFilters'
import { useRelatedPapers } from '../hooks/useRelatedPapers'
import { useClusterCatalog } from '../hooks/useClusterCatalog'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePaperBrowser } from '../hooks/usePaperBrowser'
import { usePaperDetail } from '../hooks/usePaperDetail'
import { useNavHistory } from '../hooks/useNavHistory'

export default function StatsView() {
  const { clusters, availableDomains } = useClusterCatalog()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [subgraphs, setSubgraphs] = useState<SavedGraph[]>(() =>
    listSavedGraphs(),
  )
  const [selectedSubgraphId, setSelectedSubgraphId] = useState<string | null>(
    null,
  )
  const [isCreatingSubgraph, setIsCreatingSubgraph] = useState(false)
  const [newSubgraphName, setNewSubgraphName] = useState('')
  const [viewMode, setViewMode] = useState<'browse' | 'subgraph'>('browse')
  const [subgraphNodes, setSubgraphNodes] = useState<NodeCompact[] | null>(
    null,
  )

  const createSubgraph = (name: string) => {
    const subgraph = createSavedGraph(name, [])
    setSubgraphs((prev) => [...prev, subgraph])
    setSelectedSubgraphId(subgraph.id)
  }

  const addToSelectedSubgraph = (aid: string) => {
    if (!selectedSubgraphId) return
    const current = subgraphs.find((s) => s.id === selectedSubgraphId)
    if (!current || current.paperIds.includes(aid)) return
    const updated = updateSavedGraph(selectedSubgraphId, {
      paperIds: [...current.paperIds, aid],
    })
    setSubgraphs((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    )
  }

  const removeFromSelectedSubgraph = (aid: string) => {
    if (!selectedSubgraphId) return
    const current = subgraphs.find((s) => s.id === selectedSubgraphId)
    if (!current) return
    const updated = updateSavedGraph(selectedSubgraphId, {
      paperIds: current.paperIds.filter((id) => id !== aid),
    })
    setSubgraphs((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    )
  }

  const startCreatingSubgraph = () => {
    setNewSubgraphName('')
    setIsCreatingSubgraph(true)
  }

  const cancelCreatingSubgraph = () => {
    setIsCreatingSubgraph(false)
    setNewSubgraphName('')
  }

  const confirmCreateSubgraph = () => {
    const name = newSubgraphName.trim()
    if (!name) return
    createSubgraph(name)
    setIsCreatingSubgraph(false)
    setNewSubgraphName('')
  }

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

  const { papers, total, hasMore, error, loadMore } = usePaperBrowser({
    query: debouncedQuery,
    fromDate,
    activeCids,
    activeDomains,
  })

  const {
    selectedId,
    navHistory,
    selectFromList,
    selectRelated,
    navigateTo,
    close,
  } = useNavHistory()

  const selected = usePaperDetail(selectedId)
  const { neighbors, loading: neighborsLoading } = useRelatedPapers(selectedId)

  const listRef = useRef<HTMLDivElement | null>(null)
  const autoSelectedRef = useRef(false)
  const searchBarRef = useRef<HTMLDivElement | null>(null)
  const [searchHeight, setSearchHeight] = useState(0)

  useEffect(() => {
    if (
      !autoSelectedRef.current &&
      papers &&
      papers.length > 0 &&
      selectedId === null
    ) {
      if (!window.matchMedia('(min-width: 768px)').matches) return
      autoSelectedRef.current = true
      selectFromList(papers[0].aid)
    }
  }, [papers, selectedId, selectFromList])

  const items = useMemo(() => (papers ?? []).map((n) => ({ n })), [papers])

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [items])

  useEffect(() => {
    if (!selected) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [selected])

  const handleSelectRelated = (aid: string) =>
    selectRelated(
      selected ? { aid: selected.aid, title: selected.t } : null,
      aid,
    )

  const resetKey = `${debouncedQuery}|${fromDate ?? ''}|${[...activeCids].sort()}|${[...activeDomains].sort()}`

  useLayoutEffect(() => {
    const el = searchBarRef.current
    if (!el) return
    const measure = () => setSearchHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onHome = useLocation().pathname === '/'
  const backLink = onHome ? null : (
    <Link
      to='/'
      className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
      aria-label='Back to graph'
    >
      <Share2 size={18} />
    </Link>
  )

  const selectedSubgraph = subgraphs.find(
    (subgraph) => subgraph.id === selectedSubgraphId,
  )

  const selectedSubgraphPaperIds = useMemo(
    () => new Set(selectedSubgraph?.paperIds ?? []),
    [selectedSubgraph],
  )

  useEffect(() => {
    if (viewMode !== 'subgraph' || !selectedSubgraphId) return
    let alive = true
    setSubgraphNodes(null)
    ;(async () => {
      const { fetchSubgraph } = await import('../lib/api')
      const data = await fetchSubgraph(selectedSubgraph?.paperIds ?? [])
      if (alive) setSubgraphNodes(data.nodes)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedSubgraphId])

  const toggleViewMode = () => {
    if (!selectedSubgraphId) return
    setViewMode((m) => (m === 'subgraph' ? 'browse' : 'subgraph'))
  }

  const removeFromSubgraphView = (aid: string) => {
    removeFromSelectedSubgraph(aid)
    setSubgraphNodes((prev) => (prev ?? []).filter((n) => n.aid !== aid))
  }

  const subgraphItems = useMemo(
    () => (subgraphNodes ?? []).map((n) => ({ n })),
    [subgraphNodes],
  )

  const subgraphNodeIds = useMemo(
    () => new Set((subgraphNodes ?? []).map((n) => n.aid)),
    [subgraphNodes],
  )

  const newGraphButton = (
    <button
      type='button'
      onClick={startCreatingSubgraph}
      className='shrink-0 flex items-center gap-1.5 px-3 py-[7px] rounded-full bg-[#2a2a2a] border border-[#333333] text-sm text-neutral-400 hover:text-neutral-200 whitespace-nowrap cursor-pointer'
    >
      New Graph
      <Plus size={13} />
    </button>
  )

  const subgraphControl = isCreatingSubgraph ? (
    <div className='shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#2a2a2a] border border-[#333333]'>
      <input
        autoFocus
        value={newSubgraphName}
        onChange={(e) => setNewSubgraphName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirmCreateSubgraph()
          if (e.key === 'Escape') cancelCreatingSubgraph()
        }}
        placeholder='Graph name'
        className='w-32 px-1.5 py-0.5 bg-transparent text-sm text-[#e5e5e5] placeholder-[#666666] outline-none'
      />
      <button
        type='button'
        aria-label='Create graph'
        disabled={!newSubgraphName.trim()}
        onClick={confirmCreateSubgraph}
        className='p-1 rounded-full text-neutral-400 hover:text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
      >
        <Check size={15} />
      </button>
      <button
        type='button'
        aria-label='Cancel'
        onClick={cancelCreatingSubgraph}
        className='p-1 rounded-full text-neutral-400 hover:text-neutral-200 cursor-pointer'
      >
        <X size={15} />
      </button>
    </div>
  ) : subgraphs.length === 0 ? (
    newGraphButton
  ) : (
    <div className='shrink-0 flex items-center gap-2'>
      <Dropdown label={selectedSubgraph?.name ?? 'Select graph'}>
        {subgraphs.map((subgraph) => (
          <button
            key={subgraph.id}
            type='button'
            onClick={() => setSelectedSubgraphId(subgraph.id)}
            className='block w-full text-left px-3 py-2 text-sm text-neutral-300 hover:bg-[#333333] hover:text-neutral-100'
          >
            {subgraph.name}
          </button>
        ))}
      </Dropdown>
      {selectedSubgraphId && (
        <>
          <button
            type='button'
            onClick={toggleViewMode}
            aria-label={
              viewMode === 'subgraph'
                ? 'Back to all papers'
                : 'View graph papers'
            }
            className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
          >
            {viewMode === 'subgraph' ? (
              <EyeOff size={16} />
            ) : (
              <Eye size={16} />
            )}
          </button>
          <Link
            to={`/subgraph/${selectedSubgraphId}`}
            target='_blank'
            rel='noopener noreferrer'
            aria-label='Open shareable subgraph page'
            className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
          >
            <ExternalLink size={16} />
          </Link>
        </>
      )}
      {newGraphButton}
    </div>
  )

  const searchControls = (
    <>
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
    </>
  )

  const isBrowsing = viewMode === 'browse'

  const filterBar = isBrowsing && papers ? (
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
  ) : null

  const viewingLabel = (
    <div className='flex-1 flex items-center justify-center text-sm text-neutral-400 truncate'>
      Viewing <span className='mx-1 text-neutral-200'>{selectedSubgraph?.name}</span>
      {subgraphNodes && (
        <span className='ml-1'>
          ({subgraphNodes.length} paper{subgraphNodes.length === 1 ? '' : 's'})
        </span>
      )}
    </div>
  )

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div className='hidden md:flex shrink-0 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur px-3 py-3 items-center gap-3'>
        {backLink}
        {subgraphControl}
        {isBrowsing ? (
          <div className='flex-1 flex justify-center'>
            <div className='relative w-full max-w-xl flex items-center gap-2'>
              {searchControls}
            </div>
          </div>
        ) : (
          viewingLabel
        )}
        <div className='shrink-0 w-[190px]' />
      </div>

      <div className='flex flex-row flex-1 overflow-hidden'>
        <div className='flex flex-col flex-1 overflow-hidden min-w-0'>
          {filterBar && (
            <div className='hidden md:block shrink-0 border-b border-neutral-900'>
              {filterBar}
            </div>
          )}

          <div
            ref={listRef}
            className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'
          >
            <div className='md:hidden px-4 pt-4 pb-2'>
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
              className='md:hidden sticky top-0 z-10 p-3 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 flex items-center gap-3'
            >
              {backLink}
              {subgraphControl}
              {isBrowsing ? (
                <div className='flex items-center gap-2 flex-1'>
                  {searchControls}
                </div>
              ) : (
                viewingLabel
              )}
            </div>

            {filterBar && (
              <div
                className='md:hidden sticky z-10 bg-neutral-950/90 backdrop-blur border-b border-neutral-900'
                style={{ top: searchHeight }}
              >
                {filterBar}
              </div>
            )}

            {isBrowsing && papers && total > 0 && (
              <div className='px-4 py-1.5 text-xs text-neutral-500'>
                Showing {papers.length} of {total.toLocaleString()} papers
              </div>
            )}

            {isBrowsing && error && <p className='p-4 text-red-400'>{error}</p>}

            {isBrowsing && !papers && (
              <div className='flex h-[60vh] items-center justify-center text-neutral-400'>
                Loading…
              </div>
            )}

            {isBrowsing && papers && items.length === 0 && (
              <div className='p-6 text-center text-neutral-400'>
                No matches.
              </div>
            )}

            {!isBrowsing && !subgraphNodes && (
              <div className='flex h-[60vh] items-center justify-center text-neutral-400'>
                Loading…
              </div>
            )}

            {!isBrowsing && subgraphNodes && subgraphItems.length === 0 && (
              <div className='p-6 text-center text-neutral-400'>
                No papers in this graph yet.
              </div>
            )}

            {isBrowsing ? (
              <PaperList
                items={items}
                clusters={clusters}
                onSelectId={selectFromList}
                enableHover
                resetKey={resetKey}
                hasMore={hasMore}
                onLoadMore={loadMore}
                selectedId={selectedId ?? undefined}
                onAddToSubgraph={addToSelectedSubgraph}
                onRemoveFromSubgraph={removeFromSelectedSubgraph}
                subgraphPaperIds={selectedSubgraphPaperIds}
                subgraphName={selectedSubgraph?.name}
              />
            ) : (
              <PaperList
                items={subgraphItems}
                clusters={clusters}
                onSelectId={selectFromList}
                enableHover
                resetKey={selectedSubgraphId ?? undefined}
                selectedId={selectedId ?? undefined}
                onRemoveFromSubgraph={removeFromSubgraphView}
                subgraphPaperIds={subgraphNodeIds}
                subgraphName={selectedSubgraph?.name}
              />
            )}
          </div>
        </div>

        <div className='hidden md:block w-1/2 border-l border-neutral-800 overflow-y-auto'>
          {selected ? (
            <StatsPaperDetails
              paper={selected}
              clusters={clusters}
              neighbors={neighbors}
              neighborsLoading={neighborsLoading}
              navHistory={navHistory}
              onClose={close}
              onSelectPaper={handleSelectRelated}
              onNavigateTo={navigateTo}
              onAddToSubgraph={isBrowsing ? addToSelectedSubgraph : undefined}
              onRemoveFromSubgraph={
                isBrowsing ? removeFromSelectedSubgraph : removeFromSubgraphView
              }
              subgraphPaperIds={
                isBrowsing ? selectedSubgraphPaperIds : subgraphNodeIds
              }
              subgraphName={selectedSubgraph?.name}
            />
          ) : selectedId ? (
            <div className='p-6 space-y-3 animate-pulse'>
              <div className='h-3 bg-neutral-800 rounded w-1/3' />
              <div className='h-5 bg-neutral-800 rounded w-3/4' />
              <div className='h-5 bg-neutral-800 rounded w-1/2' />
              <div className='h-3 bg-neutral-800 rounded w-1/4 mt-2' />
              <div className='h-3 bg-neutral-800 rounded w-1/4' />
              <div className='space-y-2 mt-4'>
                <div className='h-3 bg-neutral-800 rounded' />
                <div className='h-3 bg-neutral-800 rounded' />
                <div className='h-3 bg-neutral-800 rounded w-5/6' />
                <div className='h-3 bg-neutral-800 rounded w-4/6' />
              </div>
            </div>
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
            onClick={close}
            className='absolute inset-0'
          />
          <div className='relative z-10 w-full max-w-[720px] h-[92dvh] rounded-2xl shadow-2xl overflow-hidden'>
            <MobilePaperDetails
              paper={selected}
              clusters={clusters}
              neighbors={neighbors}
              neighborsLoading={neighborsLoading}
              navHistory={navHistory}
              onClose={close}
              onSelectPaper={handleSelectRelated}
              onNavigateTo={navigateTo}
            />
          </div>
        </div>
      )}
    </div>
  )
}
