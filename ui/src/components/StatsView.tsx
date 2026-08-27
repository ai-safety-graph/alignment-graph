import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Share2,
  Search,
  Trash,
  Plus,
  Check,
  X,
  Globe,
  List,
  ExternalLink,
  Trash2,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react'
import StatsPaperDetails from './StatsPaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import Dropdown from './Dropdown'
import LoadingIndicator from './LoadingIndicator'
import type { NodeCompact } from '../lib/types'
import { useServerFilters } from '../hooks/useServerFilters'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useRelatedPapers } from '../hooks/useRelatedPapers'
import { useClusterCatalog } from '../hooks/useClusterCatalog'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePaperBrowser } from '../hooks/usePaperBrowser'
import { usePaperDetail } from '../hooks/usePaperDetail'
import { useNavHistory } from '../hooks/useNavHistory'
import { useCapabilities } from '../hooks/useCapabilities'
import { useSubgraphManager } from '../hooks/useSubgraphManager'

export default function StatsView() {
  const {
    clusters,
    availableDomains,
    isLoading: clustersLoading,
  } = useClusterCatalog()
  const { semanticSearch: semanticSearchEnabled } = useCapabilities()
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>(
    'keyword',
  )
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [semanticResults, setSemanticResults] = useState<NodeCompact[] | null>(
    null,
  )
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [filterExpanded, setFilterExpanded] = useState(true)

  const {
    subgraphs,
    selectedSubgraphId,
    setSelectedSubgraphId,
    selectedSubgraph,
    selectedSubgraphPaperIds,
    isCreatingSubgraph,
    newSubgraphName,
    setNewSubgraphName,
    startCreatingSubgraph,
    cancelCreatingSubgraph,
    confirmCreateSubgraph,
    isConfirmingDelete,
    setIsConfirmingDelete,
    confirmDeleteSubgraph,
    viewMode,
    toggleViewMode,
    subgraphNodes,
    subgraphError,
    addToSelectedSubgraph,
    removeFromSelectedSubgraph,
    removeFromSubgraphView,
    subgraphQuery,
    setSubgraphQuery,
    debouncedSubgraphQuery,
    subgraphActiveCids,
    subgraphActiveDomains,
    toggleSubgraphCluster,
    toggleSubgraphDomain,
    clearSubgraphFilters,
    hasActiveSubgraphFilters,
    subgraphClusterEntries,
    subgraphAvailableDomains,
    subgraphItems,
    subgraphNodeIds,
  } = useSubgraphManager(clusters)

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

  const { papers, total, hasMore, error, loadMore, isFiltering } =
    usePaperBrowser({
      query: debouncedQuery,
      fromDate,
      activeCids,
      activeDomains,
      enabled: searchMode === 'keyword',
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

  useEffect(() => {
    if (searchMode !== 'semantic') {
      setSemanticResults(null)
      return
    }
    const q = debouncedQuery.trim()
    if (!q) {
      setSemanticResults(null)
      return
    }
    let alive = true
    setSemanticLoading(true)
    ;(async () => {
      try {
        const { searchPapers } = await import('../lib/api')
        const res = await searchPapers(q, { limit: 50 })
        if (alive)
          setSemanticResults(res.results.map((r, i) => ({ ...r, id: i })))
      } catch {
        if (alive) setSemanticResults([])
      } finally {
        if (alive) setSemanticLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [debouncedQuery, searchMode])

  const semanticItems = useMemo(
    () => (semanticResults ?? []).map((n) => ({ n })),
    [semanticResults],
  )

  const listRef = useRef<HTMLDivElement | null>(null)
  const autoSelectedRef = useRef(false)
  const searchBarRef = useRef<HTMLDivElement | null>(null)
  const [searchHeight, setSearchHeight] = useState(0)
  const isSmall = useMediaQuery('(max-width: 768px)')

  useEffect(() => {
    if (
      !autoSelectedRef.current &&
      papers &&
      papers.length > 0 &&
      selectedId === null
    ) {
      if (isSmall !== false) return
      autoSelectedRef.current = true
      selectFromList(papers[0].aid)
    }
  }, [papers, selectedId, selectFromList, isSmall])

  const items = useMemo(() => (papers ?? []).map((n) => ({ n })), [papers])

  const resetKey = `${debouncedQuery}|${fromDate ?? ''}|${[...activeCids].sort()}|${[...activeDomains].sort()}`

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [resetKey])

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
  const backLink =
    onHome || isSmall ? null : (
      <Link
        to='/'
        className='shrink-0 px-2 py-1 rounded-md cursor-pointer bg-[#2a2a2a] border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors'
        aria-label='Back to graph'
      >
        <Share2 size={18} />
      </Link>
    )

  const newGraphButton = (
    <button
      type='button'
      onClick={startCreatingSubgraph}
      className='shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#2a2a2a] border border-neutral-700 hover:border-neutral-500 text-[13px] text-neutral-300 hover:text-white whitespace-nowrap cursor-pointer transition-colors'
    >
      New Graph
      <Plus size={13} />
    </button>
  )

  const newGraphInput = (
    <div className='shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#2a2a2a] border border-[#333333]'>
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
  )

  const newGraphControl = isCreatingSubgraph ? newGraphInput : newGraphButton

  const subgraphControl =
    subgraphs.length === 0 ? null : (
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
          className='w-full pl-9 pr-3 py-1 rounded-md bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
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
      {semanticSearchEnabled && (
        <>
          <button
            type='button'
            onClick={() =>
              setSearchMode((m) => (m === 'semantic' ? 'keyword' : 'semantic'))
            }
            className={`shrink-0 px-2 py-1 rounded-md bg-[#2a2a2a] border cursor-pointer transition-colors ${
              searchMode === 'semantic'
                ? 'border-[#4ea8de] text-[#4ea8de]'
                : 'border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white'
            }`}
          >
            <Sparkles size={15} />
          </button>
          <span
            className={`shrink-0 text-[13px] whitespace-nowrap transition-colors ${searchMode === 'semantic' ? 'text-[#4ea8de]' : 'text-neutral-500'}`}
          >
            {searchMode === 'semantic'
              ? 'semantic search on'
              : 'semantic search off'}
          </span>
        </>
      )}
    </>
  )

  const subgraphSearchControls = (
    <>
      <div className='relative flex-1'>
        <Search
          className='absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400'
          size={16}
        />
        <input
          value={subgraphQuery}
          onChange={(e) => setSubgraphQuery(e.target.value)}
          placeholder={`Search papers in ${selectedSubgraph?.name ?? 'this graph'}`}
          className='w-full pl-9 pr-3 py-1 rounded-md bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
        />
      </div>
      {subgraphQuery && (
        <button
          aria-label='Clear'
          onClick={() => setSubgraphQuery('')}
          className='p-2 rounded-lg text-neutral-400 hover:text-neutral-200'
        >
          <Trash size={18} />
        </button>
      )}
    </>
  )

  const isBrowsing = viewMode === 'browse'

  const filterBar =
    isBrowsing && searchMode === 'keyword' && papers ? (
      <FilterBar
        clusterEntries={clusterEntries}
        availableDomains={availableDomains}
        isLoading={clustersLoading}
        activeCids={activeCids}
        activeDomains={activeDomains}
        datePreset={datePreset}
        hasActiveFilters={hasActiveFilters}
        onToggleCluster={toggleCluster}
        onToggleDomain={toggleDomain}
        onSetDatePreset={setDatePreset}
        onClearAll={clearAllFilters}
        isExpanded={filterExpanded}
      />
    ) : !isBrowsing && subgraphNodes && subgraphNodes.length > 0 ? (
      <FilterBar
        clusterEntries={subgraphClusterEntries}
        availableDomains={subgraphAvailableDomains}
        isLoading={clustersLoading}
        activeCids={subgraphActiveCids}
        activeDomains={subgraphActiveDomains}
        hasActiveFilters={hasActiveSubgraphFilters}
        onToggleCluster={toggleSubgraphCluster}
        onToggleDomain={toggleSubgraphDomain}
        onClearAll={clearSubgraphFilters}
        isExpanded={filterExpanded}
      />
    ) : null

  const filterToggleButton = (
    <button
      type='button'
      onClick={() => setFilterExpanded((v) => !v)}
      title={filterExpanded ? 'Collapse filters' : 'Expand filters'}
      aria-label={filterExpanded ? 'Collapse filters' : 'Expand filters'}
      className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer border border-neutral-700 hover:border-neutral-500 hover:text-white transition-colors ${filterExpanded ? 'bg-neutral-950 text-white' : 'bg-[#2a2a2a] text-neutral-300'}`}
    >
      <SlidersHorizontal size={15} />
      Filters
    </button>
  )

  const subgraphTitle = selectedSubgraph ? (
    <div className='shrink-0 px-4 py-2.5 flex items-center text-sm text-neutral-400'>
      <div className='flex-1 flex items-center gap-2'>
        <span>
          {isBrowsing ? 'Adding papers to' : 'Viewing papers in'}{' '}
          <span className='text-lg font-medium text-neutral-200'>
            {selectedSubgraph.name}
          </span>
        </span>
      </div>
      <div className='flex-1 flex justify-end items-center gap-2'>
        {isBrowsing && newGraphControl}
        {filterBar && filterToggleButton}
        {viewMode === 'subgraph' && (
          <Link
            to={`/subgraph/${selectedSubgraphId}`}
            target='_blank'
            rel='noopener noreferrer'
            title='Export subgraph'
            aria-label='Open shareable subgraph page'
            className={`shrink-0 px-1.5 py-1 rounded-md cursor-pointer border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors ${filterExpanded ? 'bg-neutral-950' : 'bg-[#2a2a2a]'}`}
          >
            <ExternalLink size={15} />
          </Link>
        )}
        {viewMode === 'subgraph' && (
          <button
            type='button'
            onClick={() => setIsConfirmingDelete(true)}
            title='Delete graph'
            aria-label='Delete graph'
            className={`shrink-0 px-1.5 py-1 rounded-md cursor-pointer border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-red-400 transition-colors ${filterExpanded ? 'bg-neutral-950' : 'bg-[#2a2a2a]'}`}
          >
            <Trash2 size={15} />
          </button>
        )}
        <button
          type='button'
          onClick={toggleViewMode}
          title={
            viewMode === 'subgraph' ? 'Browse all papers' : 'View subgraph'
          }
          aria-label={
            viewMode === 'subgraph' ? 'Back to all papers' : 'View graph papers'
          }
          className={`shrink-0 px-1.5 py-1 rounded-md cursor-pointer border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors ${filterExpanded ? 'bg-neutral-950' : 'bg-[#2a2a2a]'}`}
        >
          {viewMode === 'subgraph' ? <Globe size={15} /> : <List size={15} />}
        </button>
      </div>
    </div>
  ) : isBrowsing ? (
    <div className='shrink-0 px-4 py-2.5 flex items-center justify-between gap-2 text-sm text-neutral-400'>
      {newGraphControl}
      {filterBar && filterToggleButton}
    </div>
  ) : filterBar ? (
    <div className='shrink-0 px-4 py-2.5 flex items-center justify-end text-sm text-neutral-400'>
      {filterToggleButton}
    </div>
  ) : null

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div className='hidden md:flex relative z-20 shrink-0 bg-neutral-950/90 backdrop-blur px-4 py-3 items-center gap-3 border-b border-neutral-800'>
        {backLink}
        {subgraphControl}
        <div className='flex-1 flex justify-center'>
          <div className='relative w-full max-w-xl flex items-center gap-2'>
            {isBrowsing ? searchControls : subgraphSearchControls}
          </div>
        </div>
        <div className='shrink-0 w-[190px] flex justify-end'>
          <a
            target='_blank'
            href='https://github.com/ai-safety-graph/alignment-graph'
          >
            <img
              src='/ag-logo.svg'
              alt='Alignment Graph Logo'
              className='h-10 w-auto opacity-50 saturate-70'
            />
          </a>
        </div>
      </div>

      <div className='flex flex-row flex-1 overflow-hidden'>
        <div className='flex flex-col flex-1 overflow-hidden min-w-0'>
          <div
            ref={listRef}
            className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent [scrollbar-gutter:stable] md:[direction:rtl]'
          >
            <div className='md:[direction:ltr] md:px-4'>
              {(subgraphTitle || filterBar) && (
                <div
                  className={`hidden md:block sticky top-0 z-10 transition-colors duration-200 ${
                    filterBar && filterExpanded
                      ? 'bg-[#1f1f1f]'
                      : 'bg-neutral-950'
                  }`}
                >
                  {subgraphTitle}
                  {filterBar}
                </div>
              )}

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
                className='md:hidden sticky top-0 z-20 bg-neutral-950/90 backdrop-blur'
              >
                <div className='p-3 flex flex-col gap-2'>
                  <div className='flex items-center gap-3'>
                    {backLink}
                    {subgraphControl}
                  </div>
                  <div className='flex items-center gap-2'>
                    {isBrowsing ? searchControls : subgraphSearchControls}
                  </div>
                </div>
                {(selectedSubgraph || filterBar || isBrowsing) && (
                  <div className='px-3 pb-2 flex items-center gap-2 text-sm text-neutral-400'>
                    {!selectedSubgraph && isBrowsing && newGraphControl}
                    {selectedSubgraph && (
                      <span className='flex-1 min-w-0 truncate'>
                        {isBrowsing ? 'Adding papers to' : 'Viewing papers in'}{' '}
                        <span className='font-medium text-neutral-200'>
                          {selectedSubgraph.name}
                        </span>
                      </span>
                    )}
                    <div className='ml-auto flex items-center gap-2'>
                      {filterBar && filterToggleButton}
                      {selectedSubgraph && isBrowsing && newGraphControl}
                    </div>
                  </div>
                )}
              </div>

              {filterBar && (
                <div
                  className='md:hidden sticky z-10 bg-neutral-950/90 backdrop-blur'
                  style={{ top: searchHeight }}
                >
                  {filterBar}
                </div>
              )}

              {isBrowsing &&
                searchMode === 'keyword' &&
                papers &&
                total > 0 && (
                  <div className='px-4 py-1.5 text-xs text-neutral-500 flex items-center gap-2'>
                    <span>
                      Showing {papers.length} of {total.toLocaleString()} papers
                    </span>
                    {isFiltering && (
                      <span className='h-3 w-3 shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin' />
                    )}
                  </div>
                )}

              {isBrowsing && searchMode === 'semantic' && semanticResults && (
                <div className='px-4 py-1.5 text-xs text-neutral-500'>
                  {semanticResults.length} semantic results
                </div>
              )}

              {!isBrowsing && subgraphNodes && subgraphNodes.length > 0 && (
                <div className='px-4 py-1.5 text-xs text-neutral-500'>
                  Showing {subgraphItems.length} of {subgraphNodes.length}{' '}
                  papers
                </div>
              )}

              {isBrowsing && searchMode === 'keyword' && error && (
                <p className='p-4 text-red-400'>{error}</p>
              )}

              {isBrowsing && searchMode === 'keyword' && !papers && (
                <LoadingIndicator label='Loading Papers…' />
              )}

              {isBrowsing &&
                searchMode === 'keyword' &&
                papers &&
                items.length === 0 && (
                  <div className='p-6 text-center text-neutral-400'>
                    No matches.
                  </div>
                )}

              {isBrowsing && searchMode === 'semantic' && semanticLoading && (
                <LoadingIndicator label='Searching…' />
              )}

              {isBrowsing &&
                searchMode === 'semantic' &&
                !semanticLoading &&
                !debouncedQuery.trim() && (
                  <div className='p-6 text-center text-neutral-500 text-sm'>
                    Enter a query to search semantically.
                  </div>
                )}

              {isBrowsing &&
                searchMode === 'semantic' &&
                !semanticLoading &&
                debouncedQuery.trim() &&
                semanticResults &&
                semanticResults.length === 0 && (
                  <div className='p-6 text-center text-neutral-400'>
                    No matches.
                  </div>
                )}

              {!isBrowsing && subgraphError && (
                <p className='p-4 text-red-400'>{subgraphError}</p>
              )}

              {!isBrowsing && !subgraphNodes && !subgraphError && (
                <LoadingIndicator label='Loading Papers…' />
              )}

              {!isBrowsing && subgraphNodes && subgraphItems.length === 0 && (
                <div className='p-6 flex flex-col items-center gap-3 text-center text-neutral-400'>
                  <p>
                    {subgraphNodes.length === 0
                      ? 'No papers in this graph yet.'
                      : 'No matches.'}
                  </p>
                  {subgraphNodes.length === 0 && (
                    <button
                      type='button'
                      onClick={toggleViewMode}
                      className='flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2a2a2a] border border-[#333333] text-sm text-neutral-300 hover:text-neutral-100 cursor-pointer'
                    >
                      <Plus size={14} />
                      Add papers
                    </button>
                  )}
                </div>
              )}

              {isBrowsing ? (
                searchMode === 'semantic' ? (
                  <PaperList
                    items={semanticItems}
                    clusters={clusters}
                    clustersLoading={clustersLoading}
                    onSelectId={selectFromList}
                    enableHover
                    resetKey={`semantic|${debouncedQuery}`}
                    selectedId={selectedId ?? undefined}
                    onAddToSubgraph={
                      selectedSubgraphId ? addToSelectedSubgraph : undefined
                    }
                    onRemoveFromSubgraph={
                      selectedSubgraphId
                        ? removeFromSelectedSubgraph
                        : undefined
                    }
                    subgraphPaperIds={selectedSubgraphPaperIds}
                    subgraphName={selectedSubgraph?.name}
                  />
                ) : (
                  <div
                    className={`transition-opacity duration-150 ${isFiltering ? 'opacity-50' : ''}`}
                  >
                    <PaperList
                      items={items}
                      clusters={clusters}
                      clustersLoading={clustersLoading}
                      onSelectId={selectFromList}
                      enableHover
                      resetKey={resetKey}
                      hasMore={hasMore}
                      onLoadMore={loadMore}
                      selectedId={selectedId ?? undefined}
                      onAddToSubgraph={
                        selectedSubgraphId ? addToSelectedSubgraph : undefined
                      }
                      onRemoveFromSubgraph={
                        selectedSubgraphId
                          ? removeFromSelectedSubgraph
                          : undefined
                      }
                      subgraphPaperIds={selectedSubgraphPaperIds}
                      subgraphName={selectedSubgraph?.name}
                    />
                  </div>
                )
              ) : (
                <PaperList
                  items={subgraphItems}
                  clusters={clusters}
                  clustersLoading={clustersLoading}
                  onSelectId={selectFromList}
                  enableHover
                  resetKey={`${selectedSubgraphId ?? ''}|${debouncedSubgraphQuery}|${[...subgraphActiveCids].sort()}|${[...subgraphActiveDomains].sort()}`}
                  selectedId={selectedId ?? undefined}
                  onRemoveFromSubgraph={removeFromSubgraphView}
                  subgraphPaperIds={subgraphNodeIds}
                  subgraphName={selectedSubgraph?.name}
                />
              )}
            </div>
          </div>
        </div>

        <div className='hidden md:block w-1/2 border-l border-neutral-800 overflow-y-auto'>
          <div className='h-full'>
            {selected ? (
              <StatsPaperDetails
                paper={selected}
                clusters={clusters}
                clustersLoading={clustersLoading}
                neighbors={neighbors}
                neighborsLoading={neighborsLoading}
                navHistory={navHistory}
                onClose={close}
                onSelectPaper={handleSelectRelated}
                onNavigateTo={navigateTo}
                onAddToSubgraph={
                  isBrowsing && selectedSubgraphId
                    ? addToSelectedSubgraph
                    : undefined
                }
                onRemoveFromSubgraph={
                  isBrowsing
                    ? selectedSubgraphId
                      ? removeFromSelectedSubgraph
                      : undefined
                    : removeFromSubgraphView
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
              clustersLoading={clustersLoading}
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

      {isConfirmingDelete && (
        <div className='fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-3'>
          <button
            aria-label='Close dialog'
            onClick={() => setIsConfirmingDelete(false)}
            className='absolute inset-0'
          />
          <div className='relative z-10 w-full max-w-sm rounded-md bg-[#1f1f1f] border border-[#333333] shadow-2xl p-5 space-y-4'>
            <div className='space-y-1'>
              <h2 className='text-base font-medium text-neutral-100'>
                Delete graph
              </h2>
              <p className='text-sm text-neutral-400'>
                Delete{' '}
                <span className='text-neutral-200'>
                  {selectedSubgraph?.name}
                </span>
                ? This cannot be undone.
              </p>
            </div>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => setIsConfirmingDelete(false)}
                className='px-3 py-1.5 rounded-md text-sm text-neutral-300 bg-[#2a2a2a] border border-[#333333] hover:text-neutral-100 cursor-pointer'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={confirmDeleteSubgraph}
                className='px-3 py-1.5 rounded-md text-sm text-white bg-red-600 hover:bg-red-500 cursor-pointer'
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
