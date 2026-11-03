import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Share2,
  Search,
  Trash,
  Plus,
  CircleX,
  Pencil,
  Pin,
  Trash2,
  Sparkles,
  SlidersHorizontal,
  Info,
} from 'lucide-react'
import BrowsePaperDetails from './BrowsePaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import { track } from '../lib/analytics'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import Dropdown from './Dropdown'
import LoadingIndicator from './LoadingIndicator'
import LatestBatchBadge from './LatestBatchBadge'
import GenerateGraphModal from './GenerateGraphModal'
import type { NodeCompact } from '../lib/types'
import {
  DATE_PRESETS,
  presetToFromDate,
  useServerFilters,
} from '../hooks/useServerFilters'
import { domainLabel } from '../lib/domain'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useRelatedPapers } from '../hooks/useRelatedPapers'
import { useTagCatalog } from '../hooks/useTagCatalog'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePaperBrowser } from '../hooks/usePaperBrowser'
import { usePaperDetail } from '../hooks/usePaperDetail'
import { useNavHistory } from '../hooks/useNavHistory'
import { useCapabilities } from '../hooks/useCapabilities'
import { useSubgraphManager } from '../hooks/useSubgraphManager'
import { EMPTY_FILTERS } from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'

export default function BrowseView() {
  const { tags, availableDomains, isLoading: tagsLoading } = useTagCatalog()
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
  // Collapsed by default so the list gets the column; active filters still
  // show as a summary row while collapsed.
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [modal, setModal] = useState<'generate' | 'edit' | null>(null)

  const {
    subgraphs,
    selectedSubgraphId,
    setSelectedSubgraphId,
    selectedSubgraph,
    selectedSubgraphPaperIds,
    pinnedFull,
    createGraph,
    editGraphFilters,
    isConfirmingDelete,
    setIsConfirmingDelete,
    confirmDeleteSubgraph,
    viewMode,
    setViewMode,
    subgraphNodes,
    subgraphError,
    addToSelectedSubgraph,
    removeFromSelectedSubgraph,
    subgraphQuery,
    setSubgraphQuery,
    debouncedSubgraphQuery,
    subgraphActiveTags,
    subgraphActiveDomains,
    toggleSubgraphTag,
    toggleSubgraphDomain,
    clearSubgraphFilters,
    hasActiveSubgraphFilters,
    subgraphTagEntries,
    subgraphAvailableDomains,
    subgraphItems,
  } = useSubgraphManager()

  const {
    fromDate,
    datePreset,
    setDatePreset,
    peerReviewedOnly,
    togglePeerReviewed,
    activeTags,
    activeDomains,
    tagEntries,
    hasActiveFilters,
    clearAllFilters,
    toggleTag,
    toggleDomain,
  } = useServerFilters(tags)

  // With a graph selected the list shows its recipe's matches, its pins, or
  // all papers to pin from. The filter bar (and semantic search) only drive
  // the lists of all papers; a graph's matches use its own recipe.
  const listMode = selectedSubgraph ? viewMode : 'all'
  const isBrowsing = listMode !== 'pinned'
  const isMatches = listMode === 'matches'
  const recipe = selectedSubgraph?.filters
  const canFilter = listMode === 'all'
  const semantic = canFilter && searchMode === 'semantic'

  const recipeParams = useMemo(
    () =>
      recipe && {
        fromDate: presetToFromDate(recipe.datePreset),
        activeTags: new Set(recipe.tags),
        activeDomains: new Set(recipe.domains),
        peerReviewed: recipe.peerReviewed ?? false,
      },
    [recipe],
  )
  const listParams =
    isMatches && recipeParams
      ? recipeParams
      : { fromDate, activeTags, activeDomains, peerReviewed: peerReviewedOnly }

  const {
    papers: listedPapers,
    total,
    hasMore,
    error,
    loadMore,
    isFiltering,
  } = usePaperBrowser({
    query: debouncedQuery,
    ...listParams,
    enabled: isBrowsing && !semantic && (!isMatches || !!recipe),
  })
  // Recipe matches the user hid (on older builds) aren't in the graph
  const hidden = selectedSubgraph?.hidden
  const papers = useMemo(() => {
    // A pins-only graph has no matches. The disabled query would still hand
    // back the All papers list cached under the same key.
    if (isMatches && !recipe) return null
    if (!isMatches || !listedPapers || !hidden?.length) return listedPapers
    const skip = new Set(hidden)
    return listedPapers.filter((n) => !skip.has(n.aid))
  }, [isMatches, recipe, listedPapers, hidden])

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
    if (!semantic) {
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
  }, [debouncedQuery, semantic])

  const semanticItems = useMemo(
    () => (semanticResults ?? []).map((n) => ({ n })),
    [semanticResults],
  )

  const listRef = useRef<HTMLDivElement | null>(null)
  const autoSelectedRef = useRef(false)
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

  const resetKey = `${listMode}|${selectedSubgraphId ?? ''}|${debouncedQuery}|${listParams.fromDate ?? ''}|${[...listParams.activeTags].sort()}|${[...listParams.activeDomains].sort()}`

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

  const view = isSmall ? 'mobile' : 'browse'

  const handleSelectFromList = (aid: string) => {
    track('paper_open', { view, source: debouncedQuery ? 'search' : 'list' })
    selectFromList(aid)
  }

  const handleSelectRelated = (aid: string) => {
    track('paper_open', { view, source: 'related' })
    selectRelated(
      selected ? { aid: selected.aid, title: selected.t } : null,
      aid,
    )
  }

  const onHome = useLocation().pathname === '/'
  const backLink =
    onHome || isSmall ? null : (
      <Link
        to='/'
        className='shrink-0 px-2 py-1 rounded-md cursor-pointer bg-neutral-950 border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors'
        aria-label='Back to graph'
      >
        <Share2 size={18} />
      </Link>
    )

  const aboutLink = (
    <Link
      to='/about'
      className='shrink-0 flex items-center gap-1.5 cursor-pointer text-[13px] text-neutral-300 hover:text-white underline underline-offset-2 transition-colors'
    >
      <Info size={14} />
      About
    </Link>
  )

  const newGraphButton = (
    <button
      type='button'
      onClick={() => setModal('generate')}
      title='Generate graph'
      aria-label='Generate graph'
      className='shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-[#4ea8de] border border-[#4ea8de] text-[13px] font-medium text-neutral-950 hover:bg-[#6bb8e6] whitespace-nowrap transition-colors'
    >
      <Plus size={14} />
      <span className='hidden lg:inline'>Generate graph</span>
    </button>
  )

  const renderSubgraphDropdown = (className: string) => (
    <Dropdown
      className={className}
      label={selectedSubgraph?.name ?? 'All papers'}
    >
      {[{ id: null, name: 'All papers' }, ...subgraphs].map((subgraph) => (
        <button
          key={subgraph.id ?? ''}
          type='button'
          onClick={() => setSelectedSubgraphId(subgraph.id)}
          title={subgraph.name}
          className={`block w-full truncate text-left px-3 py-2 text-sm hover:bg-[#333333] hover:text-neutral-100 cursor-pointer ${
            selectedSubgraphId === subgraph.id
              ? 'text-[#4ea8de]'
              : 'text-neutral-300'
          }`}
        >
          {subgraph.name}
        </button>
      ))}
    </Dropdown>
  )

  const editSubgraphButton = selectedSubgraph && (
    <button
      type='button'
      onClick={() => setModal('edit')}
      aria-label={`Edit “${selectedSubgraph.name}”`}
      title='Edit graph filters'
      className='shrink-0 p-1.5 rounded-md bg-neutral-950 border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 cursor-pointer transition-colors'
    >
      <Pencil size={14} />
    </button>
  )

  const deleteSubgraphButton = selectedSubgraph && (
    <button
      type='button'
      onClick={() => setIsConfirmingDelete(true)}
      aria-label={`Delete “${selectedSubgraph.name}”`}
      title='Delete graph'
      className='shrink-0 p-1.5 rounded-md bg-neutral-950 border border-neutral-700 text-neutral-300 hover:text-red-400 hover:border-neutral-500 cursor-pointer transition-colors'
    >
      <Trash2 size={14} />
    </button>
  )

  // Desktop header: generate, pick a graph (or all papers), edit, delete,
  // in the graph view's order
  const subgraphControl = (
    <div className='shrink-0 flex items-center gap-2'>
      {newGraphButton}
      {subgraphs.length > 0 &&
        renderSubgraphDropdown('md:max-w-[140px] lg:max-w-[240px]')}
      {editSubgraphButton}
      {deleteSubgraphButton}
    </div>
  )

  // Mobile: sits inline in the status row and shrinks to leave room for
  // the action buttons.
  const subgraphDropdown = renderSubgraphDropdown('max-w-full')

  const searchControls = (
    <>
      <div className='relative flex-1 min-w-0'>
        <Search
          className='absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400'
          size={16}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            isMatches
              ? `Search papers in ${selectedSubgraph?.name ?? 'this graph'}`
              : 'Search papers on AI safety & alignment'
          }
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
      {semanticSearchEnabled && canFilter && (
        <>
          <button
            type='button'
            aria-pressed={searchMode === 'semantic'}
            title={
              searchMode === 'semantic'
                ? 'Semantic search on'
                : 'Semantic search off'
            }
            onClick={() => {
              const next = searchMode === 'semantic' ? 'keyword' : 'semantic'
              track('search_mode', { mode: next })
              setSearchMode(next)
            }}
            className={`shrink-0 px-2 py-1 rounded-md bg-neutral-950 border cursor-pointer transition-colors ${
              searchMode === 'semantic'
                ? 'border-[#4ea8de] text-[#4ea8de]'
                : 'border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white'
            }`}
          >
            <Sparkles size={15} />
          </button>
          <span
            className={`hidden xl:inline shrink-0 text-[13px] whitespace-nowrap transition-colors ${searchMode === 'semantic' ? 'text-[#4ea8de]' : 'text-neutral-500'}`}
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
      <div className='relative flex-1 min-w-0'>
        <Search
          className='absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400'
          size={16}
        />
        <input
          value={subgraphQuery}
          onChange={(e) => setSubgraphQuery(e.target.value)}
          placeholder={`Search pinned papers in ${selectedSubgraph?.name ?? 'this graph'}`}
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

  const filterBar =
    canFilter && !semantic && papers ? (
      <FilterBar
        tagEntries={tagEntries}
        availableDomains={availableDomains}
        isLoading={tagsLoading}
        activeTags={activeTags}
        activeDomains={activeDomains}
        datePreset={datePreset}
        hasActiveFilters={hasActiveFilters}
        onToggleTag={toggleTag}
        onToggleDomain={toggleDomain}
        onSetDatePreset={setDatePreset}
        peerReviewedOnly={peerReviewedOnly}
        onTogglePeerReviewed={togglePeerReviewed}
        onClearAll={clearAllFilters}
        isExpanded={filterExpanded}
        showTagCounts={false}
        bordered={!isSmall}
      />
    ) : listMode === 'pinned' && subgraphNodes && subgraphNodes.length > 0 ? (
      <FilterBar
        tagEntries={subgraphTagEntries}
        availableDomains={subgraphAvailableDomains}
        isLoading={tagsLoading}
        activeTags={subgraphActiveTags}
        activeDomains={subgraphActiveDomains}
        hasActiveFilters={hasActiveSubgraphFilters}
        onToggleTag={toggleSubgraphTag}
        onToggleDomain={toggleSubgraphDomain}
        onClearAll={clearSubgraphFilters}
        isExpanded={filterExpanded}
        bordered={!isSmall}
      />
    ) : null

  // Filters apply live, so the mobile sheet shows the result count while open
  const filterCountLabel = canFilter
    ? papers
      ? `${total.toLocaleString()} papers`
      : ''
    : `${subgraphItems.length} of ${subgraphNodes?.length ?? 0} pinned papers`

  const activeFilterCount = canFilter
    ? activeTags.size +
      activeDomains.size +
      (datePreset !== 'all' ? 1 : 0) +
      (peerReviewedOnly ? 1 : 0)
    : subgraphActiveTags.size + subgraphActiveDomains.size

  const filterToggleButton = (
    <button
      type='button'
      onClick={() => setFilterExpanded((v) => !v)}
      title={filterExpanded ? 'Collapse filters' : 'Expand filters'}
      aria-label={filterExpanded ? 'Collapse filters' : 'Expand filters'}
      className={`shrink-0 flex items-center md:gap-1.5 px-2 py-0.5 rounded-md cursor-pointer bg-neutral-950 border hover:border-neutral-500 hover:text-white transition-colors ${filterExpanded ? 'border-neutral-500 text-white' : 'border-neutral-700 text-neutral-300'}`}
    >
      <SlidersHorizontal size={15} />
      <span className='hidden md:inline'>Filters</span>
      {activeFilterCount > 0 && (
        <span className='ml-1 md:ml-0 min-w-4 h-4 px-1 rounded-full bg-[#4ea8de] text-[10px] leading-4 text-neutral-950 font-medium'>
          {activeFilterCount}
        </span>
      )}
    </button>
  )

  const pinnedCount = selectedSubgraph?.pinned.length ?? 0
  const listModeTabs = selectedSubgraph && (
    <div
      role='tablist'
      aria-label={`Papers in ${selectedSubgraph.name}`}
      className='shrink-0 flex items-center p-0.5 rounded-md border border-neutral-700 bg-neutral-950 text-[13px]'
    >
      {(
        [
          ['matches', 'Matches', null],
          ['pinned', 'Pinned', pinnedCount],
          ['all', 'All papers', null],
        ] as const
      ).map(([mode, label, count]) => (
        <button
          key={mode}
          type='button'
          role='tab'
          aria-selected={listMode === mode}
          onClick={() => setViewMode(mode)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors ${
            listMode === mode
              ? 'bg-neutral-800 text-white'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          {mode === 'pinned' && <Pin size={12} />}
          {label}
          {count != null && <span className='tabular-nums'>{count}</span>}
        </button>
      ))}
    </div>
  )

  const subgraphTitle = (
    <div className='shrink-0 px-4 py-2.5 flex items-center justify-between gap-2 text-sm text-neutral-400'>
      <span className='min-w-0 truncate'>
        {selectedSubgraph ? (
          <>
            {listMode === 'matches'
              ? 'Papers in'
              : listMode === 'pinned'
                ? 'Pinned in'
                : 'Pinning to'}{' '}
            <span className='text-lg font-medium text-neutral-200'>
              {selectedSubgraph.name}
            </span>
          </>
        ) : (
          <span className='text-lg font-medium text-neutral-200'>
            All papers
          </span>
        )}
      </span>
      <div className='shrink-0 flex items-center gap-2'>
        {/* Filters sits left of the tabs, so they don't move when it comes
            and goes between tabs */}
        {filterBar && filterToggleButton}
        {listModeTabs}
      </div>
    </div>
  )

  // The graph's recipe, read-only: Edit changes it, as on the graph view
  const recipeLabels = recipe
    ? [
        ...recipe.tags,
        ...recipe.domains.map(domainLabel),
        ...(recipe.datePreset === 'all'
          ? []
          : [
              DATE_PRESETS.find((p) => p.value === recipe.datePreset)?.label ??
                recipe.datePreset,
            ]),
        ...(recipe.peerReviewed ? ['Peer-reviewed'] : []),
      ]
    : []
  const recipeSummary = isMatches && selectedSubgraph && (
    <div className='px-4 pb-2 flex flex-wrap items-center gap-1.5 text-[13px] text-neutral-400'>
      {recipe ? (
        <>
          <span className='mr-0.5'>Filters</span>
          {recipeLabels.length === 0 && (
            <span className='text-neutral-300'>All papers</span>
          )}
          {recipeLabels.map((label) => (
            <span
              key={label}
              className='px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-300'
            >
              {label}
            </span>
          ))}
        </>
      ) : (
        <span>No filters: this graph holds only pinned papers.</span>
      )}
      <button
        type='button'
        onClick={() => setModal('edit')}
        className='ml-1 flex items-center gap-1 text-neutral-400 hover:text-white underline underline-offset-2 cursor-pointer'
      >
        <Pencil size={12} />
        {recipe ? 'Edit' : 'Add filters'}
      </button>
    </div>
  )

  // The modal starts from the filters being browsed, so filtering the list
  // and then generating makes a graph of what's on screen
  const browseFilters: GraphFilters =
    canFilter && !semantic
      ? {
          tags: [...activeTags],
          domains: [...activeDomains],
          datePreset,
          ...(peerReviewedOnly ? { peerReviewed: true } : {}),
        }
      : EMPTY_FILTERS

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div className='hidden md:flex relative z-20 shrink-0 bg-neutral-950 px-4 py-3 items-center gap-3 border-b border-neutral-800'>
        {backLink}
        {subgraphControl}
        <div className='flex-1 min-w-0 flex justify-center'>
          <div className='relative w-full min-w-0 max-w-xl flex items-center gap-2'>
            {isBrowsing ? searchControls : subgraphSearchControls}
          </div>
        </div>
        <div className='shrink-0 min-w-[190px] flex justify-end items-center gap-4 xl:gap-10'>
          {aboutLink}
          <LatestBatchBadge className='hidden lg:inline' />
          <a
            target='_blank'
            href='https://github.com/ai-safety-graph/alignment-graph'
          >
            <img
              src='/ag-logo.svg'
              alt='Alignment Graph Logo'
              className='h-[34px] w-auto opacity-50 saturate-70'
            />
          </a>
        </div>
      </div>

      <div className='flex flex-row flex-1 overflow-hidden'>
        <div className='flex flex-col flex-1 overflow-hidden min-w-0'>
          <div
            ref={listRef}
            className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent [scrollbar-gutter:stable_both-edges] md:[scrollbar-gutter:stable] md:[direction:rtl]'
          >
            <div className='md:[direction:ltr] md:px-8'>
              <div className='hidden md:block sticky top-0 z-10 bg-neutral-950'>
                {subgraphTitle}
                {recipeSummary}
                {filterBar}
              </div>

              <div className='md:hidden relative px-4 pt-4 pb-2 flex flex-col items-center gap-1'>
                <div className='absolute top-4 left-4 flex items-center h-[34px]'>
                  <LatestBatchBadge />
                </div>
                <div className='absolute top-4 right-4 flex items-center h-[34px]'>
                  {aboutLink}
                </div>
                <a
                  target='_blank'
                  href='https://github.com/ai-safety-graph/alignment-graph'
                  className='flex items-center justify-center'
                >
                  <img
                    src='/ag-logo.svg'
                    alt='Alignment Graph Logo'
                    className='h-[34px] w-auto opacity-50 saturate-70'
                  />
                </a>
              </div>

              <div className='md:hidden sticky top-0 z-20 bg-neutral-950'>
                <div className='p-3 flex flex-col gap-2'>
                  {backLink && (
                    <div className='flex items-center gap-3'>{backLink}</div>
                  )}
                  <div className='flex items-center gap-2'>
                    {isBrowsing ? searchControls : subgraphSearchControls}
                  </div>
                </div>
                <div className='px-3 pb-2 flex items-center gap-2 text-sm text-neutral-400'>
                  {newGraphButton}
                  {subgraphs.length > 0 && (
                    <div className='flex-1 min-w-0 flex items-center'>
                      {subgraphDropdown}
                    </div>
                  )}
                  <div className='ml-auto flex items-center gap-2'>
                    {filterBar && filterToggleButton}
                    {editSubgraphButton}
                    {deleteSubgraphButton}
                  </div>
                </div>
                {listModeTabs && (
                  <div className='px-3 pb-2 flex'>{listModeTabs}</div>
                )}
                {recipeSummary && (
                  <div className='-mx-1 pb-1'>{recipeSummary}</div>
                )}
              </div>

              {isBrowsing &&
                !semantic &&
                papers &&
                total > 0 && (
                  <div className='px-4 py-1.5 text-xs text-neutral-500 flex items-center gap-2'>
                    <span>
                      Showing {papers.length} of {total.toLocaleString()}{' '}
                      {isMatches ? 'matching papers' : 'papers'}
                    </span>
                    {isFiltering && (
                      <span className='h-3 w-3 shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin' />
                    )}
                  </div>
                )}

              {isBrowsing && semantic && semanticResults && (
                <div className='px-4 py-1.5 text-xs text-neutral-500'>
                  {semanticResults.length} semantic results
                </div>
              )}

              {!isBrowsing && subgraphNodes && subgraphNodes.length > 0 && (
                <div className='px-4 py-1.5 text-xs text-neutral-500'>
                  Showing {subgraphItems.length} of {subgraphNodes.length}{' '}
                  pinned papers
                </div>
              )}

              {isBrowsing && !semantic && error && (!isMatches || recipe) && (
                <p className='p-4 text-red-400'>{error}</p>
              )}

              {isBrowsing && !semantic && !papers && (!isMatches || recipe) && (
                <LoadingIndicator label='Loading Papers…' />
              )}

              {isBrowsing &&
                !semantic &&
                papers &&
                items.length === 0 && (
                  <div className='p-6 text-center text-neutral-400'>
                    No matches.
                  </div>
                )}

              {isBrowsing && semantic && semanticLoading && (
                <LoadingIndicator label='Searching…' />
              )}

              {isBrowsing &&
                semantic &&
                !semanticLoading &&
                !debouncedQuery.trim() && (
                  <div className='p-6 text-center text-neutral-500 text-sm'>
                    Enter a query to search semantically.
                  </div>
                )}

              {isBrowsing &&
                semantic &&
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
                      ? 'No pinned papers yet.'
                      : 'No matches.'}
                  </p>
                  {subgraphNodes.length === 0 && (
                    <button
                      type='button'
                      onClick={() => setViewMode('all')}
                      className='flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-950 border border-[#333333] text-sm text-neutral-300 hover:text-neutral-100 cursor-pointer'
                    >
                      <Plus size={14} />
                      Browse papers to pin
                    </button>
                  )}
                </div>
              )}

              {isBrowsing ? (
                semantic ? (
                  <PaperList
                    items={semanticItems}
                    onSelectId={handleSelectFromList}
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
                    subgraphFull={pinnedFull}
                  />
                ) : (
                  <div
                    className={`transition-opacity duration-150 ${isFiltering ? 'opacity-50' : ''}`}
                  >
                    <PaperList
                      items={items}
                      onSelectId={handleSelectFromList}
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
                      subgraphFull={pinnedFull}
                    />
                  </div>
                )
              ) : (
                <PaperList
                  items={subgraphItems}
                  onSelectId={handleSelectFromList}
                  enableHover
                  resetKey={`${selectedSubgraphId ?? ''}|${debouncedSubgraphQuery}|${[...subgraphActiveTags].sort()}|${[...subgraphActiveDomains].sort()}`}
                  selectedId={selectedId ?? undefined}
                  onRemoveFromSubgraph={removeFromSelectedSubgraph}
                  subgraphPaperIds={selectedSubgraphPaperIds}
                  subgraphName={selectedSubgraph?.name}
                />
              )}
            </div>
          </div>
        </div>

        <div className='hidden md:block w-1/2 border-l border-neutral-800 overflow-y-auto'>
          <div className='h-full'>
            {selected ? (
              <BrowsePaperDetails
                paper={selected}
                neighbors={neighbors}
                neighborsLoading={neighborsLoading}
                navHistory={navHistory}
                onClose={close}
                onSelectPaper={handleSelectRelated}
                onNavigateTo={navigateTo}
                onAddToSubgraph={
                  selectedSubgraphId ? addToSelectedSubgraph : undefined
                }
                onRemoveFromSubgraph={
                  selectedSubgraphId ? removeFromSelectedSubgraph : undefined
                }
                subgraphPaperIds={selectedSubgraphPaperIds}
                subgraphName={selectedSubgraph?.name}
                subgraphFull={pinnedFull}
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

      {filterBar && filterExpanded && isSmall && (
        <div className='md:hidden fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-3'>
          <button
            aria-label='Close filters'
            onClick={() => setFilterExpanded(false)}
            className='absolute inset-0'
          />
          <div
            role='dialog'
            aria-label='Filters'
            className='relative z-10 w-full max-w-[720px] max-h-[92dvh] flex flex-col rounded-2xl border border-[#333333] bg-neutral-950 shadow-2xl overflow-hidden'
          >
            <div className='shrink-0 pl-5 pr-3 pt-3 flex items-center justify-between gap-2'>
              <span className='text-xs text-neutral-500'>
                {filterCountLabel}
              </span>
              <button
                type='button'
                aria-label='Close filters'
                onClick={() => setFilterExpanded(false)}
                className='p-1.5 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200'
              >
                <CircleX size={20} />
              </button>
            </div>
            <div className='overflow-y-auto overscroll-contain pb-2 scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent'>
              {filterBar}
            </div>
          </div>
        </div>
      )}

      {selectedId && (
        <div className='md:hidden fixed inset-0 z-20 bg-black/70 flex items-center justify-center p-2'>
          <button
            aria-label='Close overlay'
            onClick={close}
            className='absolute inset-0'
          />
          <div className='relative z-10 w-full max-w-[720px] h-[calc(100dvh-1rem)] rounded-2xl shadow-2xl overflow-hidden'>
            {selected ? (
              <MobilePaperDetails
                paper={selected}
                neighbors={neighbors}
                neighborsLoading={neighborsLoading}
                navHistory={navHistory}
                onClose={close}
                onSelectPaper={handleSelectRelated}
                onNavigateTo={navigateTo}
                onAddToSubgraph={
                  selectedSubgraphId ? addToSelectedSubgraph : undefined
                }
                onRemoveFromSubgraph={
                  selectedSubgraphId ? removeFromSelectedSubgraph : undefined
                }
                subgraphPaperIds={selectedSubgraphPaperIds}
                subgraphName={selectedSubgraph?.name}
                subgraphFull={pinnedFull}
              />
            ) : (
              <div className='w-full h-full bg-neutral-950 border border-[#333333] rounded-2xl'>
                <LoadingIndicator label='Loading paper…' className='h-full' />
              </div>
            )}
          </div>
        </div>
      )}

      {modal && (
        <GenerateGraphModal
          key={modal}
          mode={modal}
          initialFilters={
            modal === 'edit'
              ? (selectedSubgraph?.filters ?? EMPTY_FILTERS)
              : browseFilters
          }
          onSave={
            modal === 'generate'
              ? (filters, name) => {
                  const err = createGraph(filters, name)
                  if (!err) {
                    track('graph_save', { kind: 'new', view })
                    setModal(null)
                  }
                  return err
                }
              : undefined
          }
          onGenerate={
            modal === 'edit'
              ? (filters) => {
                  track('graph_edit', { view })
                  editGraphFilters(filters)
                  setModal(null)
                }
              : undefined
          }
          onClose={() => setModal(null)}
        />
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
                className='px-3 py-1.5 rounded-md text-sm text-neutral-300 bg-neutral-950 border border-[#333333] hover:text-neutral-100 cursor-pointer'
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
