import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import {
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
  Check,
  Layers,
  Library,
  ListChecks,
} from 'lucide-react'
import BrowsePaperDetails from './BrowsePaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import { track } from '../lib/analytics'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
import Dropdown from './Dropdown'
import LoadingIndicator from './LoadingIndicator'
import LatestBatchBadge from './LatestBatchBadge'
import { HeaderLogo, ViewSwitch } from './HeaderNav'
import { NewGraphButton, NewGraphMenuItem } from './NewGraph'
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
  // Phones pick a graph (and edit or delete it) from a bottom sheet
  const [graphSheetOpen, setGraphSheetOpen] = useState(false)

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
  // Tailwind's md is width >= 48rem; the exact complement agrees with
  // the md: classes at every width, fractional ones included
  const isSmall = useMediaQuery('(width < 48rem)')
  // The graph sheet is phone-only: widening the screen closes it, so it
  // doesn't pop back up untapped if the screen narrows again
  if (graphSheetOpen && isSmall === false) setGraphSheetOpen(false)

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

  const resetKey = `${listMode}|${selectedSubgraphId ?? ''}|${debouncedQuery}|${listParams.fromDate ?? ''}|${[...listParams.activeTags].sort()}|${[...listParams.activeDomains].sort()}|${listParams.peerReviewed ? 1 : 0}`

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

  const aboutLink = (
    <Link
      to='/about'
      className='shrink-0 flex items-center gap-1.5 cursor-pointer text-[13px] text-neutral-300 hover:text-white underline underline-offset-2 transition-colors'
    >
      <Info size={14} />
      About
    </Link>
  )

  const openNewGraph = () => setModal('generate')

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
      <NewGraphMenuItem onClick={openNewGraph} />
    </Dropdown>
  )

  // A graph is edited or deleted from its own lists (Matches, Pinned), not
  // while browsing all papers to pin from
  const showGraphActions = !!selectedSubgraph && listMode !== 'all'

  // Picking a graph and starting a new one share the dropdown. With no
  // graphs yet there's nothing to pick, so a New graph button stands in.
  const renderGraphPicker = (className: string) =>
    subgraphs.length > 0 ? (
      renderSubgraphDropdown(className)
    ) : (
      <NewGraphButton onClick={openNewGraph} />
    )

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
              ? 'Search this graph'
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
          placeholder='Search pinned papers'
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
          {/* No count until something's pinned */}
          {!!count && <span className='tabular-nums'>{count}</span>}
        </button>
      ))}
    </div>
  )

  // Phones keep the list modes and the graph in a bottom bar, as a native
  // app would; the graph slot opens a sheet to switch, edit or delete
  const bottomTabs = [
    ['matches', 'Matches', ListChecks],
    ['pinned', 'Pinned', Pin],
    ['all', 'All papers', Library],
  ] as const
  const bottomBar = (
    <nav
      aria-label='Papers and graphs'
      className='md:hidden fixed inset-x-0 bottom-0 z-10 flex items-stretch border-t border-neutral-800 bg-neutral-950 text-[11px]'
    >
      {selectedSubgraph && (
        <div
          role='tablist'
          aria-label={`Papers in ${selectedSubgraph.name}`}
          className='flex flex-[3] min-w-0'
        >
          {bottomTabs.map(([mode, label, Icon]) => (
            <button
              key={mode}
              type='button'
              role='tab'
              aria-selected={listMode === mode}
              onClick={() => setViewMode(mode)}
              className={`flex-1 min-w-0 h-14 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                listMode === mode
                  ? 'text-[#4ea8de]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Icon size={18} />
              <span className='max-w-full truncate'>
                {label}
                {/* No count until something's pinned */}
                {mode === 'pinned' && !!pinnedCount && (
                  <span className='tabular-nums'> {pinnedCount}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {subgraphs.length > 0 ? (
        <button
          type='button'
          aria-haspopup='dialog'
          aria-expanded={graphSheetOpen}
          aria-label={`Graph: ${selectedSubgraph?.name ?? 'All papers'}`}
          onClick={() => setGraphSheetOpen(true)}
          className={`flex-1 min-w-0 h-14 px-2 flex flex-col items-center justify-center gap-1 cursor-pointer text-neutral-300 hover:text-white ${selectedSubgraph ? 'border-l border-neutral-800' : ''}`}
        >
          <Layers size={18} />
          <span className='max-w-full truncate'>
            {selectedSubgraph?.name ?? 'All papers'}
          </span>
        </button>
      ) : (
        <button
          type='button'
          onClick={openNewGraph}
          className='flex-1 h-14 flex flex-col items-center justify-center gap-1 cursor-pointer text-[#4ea8de] hover:text-[#6bb8e6]'
        >
          <Plus size={18} />
          New graph
        </button>
      )}
    </nav>
  )

  const closeSheetThen = (action: () => void) => () => {
    setGraphSheetOpen(false)
    action()
  }
  const sheetRowClass =
    'flex w-full items-center gap-3 px-5 py-3 text-left text-[15px] cursor-pointer hover:bg-neutral-900'
  const graphSheet = graphSheetOpen && isSmall && (
    <div className='md:hidden fixed inset-0 z-30 bg-black/70 flex items-end'>
      <button
        aria-label='Close graphs'
        onClick={() => setGraphSheetOpen(false)}
        className='absolute inset-0'
      />
      <div
        role='dialog'
        aria-label='Graphs'
        className='relative z-10 w-full max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-[#333333] bg-neutral-950 shadow-2xl'
      >
        <div className='mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-neutral-700' />
        {[{ id: null, name: 'All papers' }, ...subgraphs].map((subgraph) => {
          const current = selectedSubgraphId === subgraph.id
          return (
            <button
              key={subgraph.id ?? ''}
              type='button'
              aria-current={current || undefined}
              onClick={closeSheetThen(() => setSelectedSubgraphId(subgraph.id))}
              className={`${sheetRowClass} ${current ? 'text-[#4ea8de]' : 'text-neutral-200'}`}
            >
              <Check
                size={16}
                className={`shrink-0 ${current ? '' : 'invisible'}`}
              />
              <span className='min-w-0 truncate'>{subgraph.name}</span>
            </button>
          )
        })}
        <button
          type='button'
          onClick={closeSheetThen(openNewGraph)}
          className={`${sheetRowClass} text-[#4ea8de]`}
        >
          <Plus size={16} className='shrink-0' />
          New graph
        </button>
        {selectedSubgraph && (
          <div className='mt-1 border-t border-neutral-800 py-1'>
            <button
              type='button'
              onClick={closeSheetThen(() => setModal('edit'))}
              className={`${sheetRowClass} text-neutral-200`}
            >
              <Pencil size={16} className='shrink-0' />
              <span className='min-w-0 truncate'>
                {recipe ? 'Edit filters' : 'Add filters'}
              </span>
            </button>
            <button
              type='button'
              onClick={closeSheetThen(() => setIsConfirmingDelete(true))}
              className={`${sheetRowClass} text-red-400`}
            >
              <Trash2 size={16} className='shrink-0' />
              <span className='min-w-0 truncate'>
                Delete “{selectedSubgraph.name}”
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )

  // The dropdown above already names the graph, so this row is just the
  // list-mode tabs (or a plain label) and the Filters toggle.
  const subgraphTitle = (
    <div className='shrink-0 px-4 pt-4 pb-2 flex items-center justify-between gap-3 text-sm text-neutral-400'>
      {listModeTabs || (
        <span className='min-w-0 truncate text-lg font-medium text-neutral-200'>
          All papers
        </span>
      )}
      {filterBar && filterToggleButton}
    </div>
  )

  // Only the all-papers list mentions the latest update (About does too);
  // wide screens only, as the half-width list column at md has no room
  const batchNote = listMode === 'all' && (
    <LatestBatchBadge className="hidden lg:inline before:content-['·'] before:mr-2" />
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
  const editRecipeButton = (
    <button
      type='button'
      onClick={() => setModal('edit')}
      className='hidden md:flex items-center gap-1 text-neutral-500 hover:text-white underline underline-offset-2 cursor-pointer'
    >
      <Pencil size={11} />
      {recipe ? 'Edit' : 'Add filters'}
    </button>
  )

  // Desktop only: phones edit and delete from the graph sheet
  const recipeActions = (
    <div className='shrink-0 flex items-center gap-3'>
      {editRecipeButton}
      <button
        type='button'
        onClick={() => setIsConfirmingDelete(true)}
        className='hidden md:flex items-center gap-1 text-neutral-500 hover:text-red-400 underline underline-offset-2 cursor-pointer'
      >
        <Trash2 size={11} />
        Delete
      </button>
    </div>
  )

  // The count follows the debounced search, so the wording does too
  const searching = !!debouncedQuery.trim()
  const matchVerb = total === 1 ? 'matches' : 'match'
  const matchesPhrase =
    recipeLabels.length > 0
      ? ` ${matchVerb} ${searching ? 'your search and ' : ''}these filters:`
      : searching
        ? ` ${matchVerb} your search`
        : ' (no filters)'

  // Whether the count line (or the pins-only summary) is already showing
  // Edit/Delete, so the fallback row below it isn't needed
  const graphActionsInline = isMatches
    ? !recipe || !!papers
    : listMode === 'pinned' && !!subgraphNodes?.length

  // A graph with a recipe shows it in the count line; a pins-only graph has
  // no matches to count, so it says so here
  const recipeSummary = isMatches && selectedSubgraph && !recipe && (
    <div className='px-4 pb-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500'>
      <span>No filters: this graph holds only pinned papers.</span>
      {recipeActions}
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
        {/* The two sides split the leftover width equally (but never below
            their content), which keeps the search box centred on the page */}
        <div className='flex-1 basis-0 min-w-fit pr-4 flex items-center gap-3'>
          <HeaderLogo current='list' />
          {renderGraphPicker('md:max-w-[160px] lg:max-w-[320px]')}
        </div>
        <div className='relative flex-[0_1_36rem] min-w-0 flex items-center gap-2'>
          {isBrowsing ? searchControls : subgraphSearchControls}
        </div>
        <div className='flex-1 basis-0 min-w-fit pl-4 flex justify-end items-center gap-4'>
          <ViewSwitch current='list' />
          {aboutLink}
        </div>
      </div>

      <div className='flex flex-row flex-1 overflow-hidden'>
        <div className='flex flex-col flex-1 overflow-hidden min-w-0'>
          <div
            ref={listRef}
            className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent [scrollbar-gutter:stable_both-edges] md:[scrollbar-gutter:stable] md:[direction:rtl]'
          >
            <div className='md:[direction:ltr] md:px-8 pb-14 md:pb-0'>
              <div className='md:hidden relative px-4 pt-4 pb-2 flex flex-col items-center gap-1'>
                {listMode === 'all' && (
                  <div className='absolute top-4 left-4 flex items-center h-[30px]'>
                    <LatestBatchBadge />
                  </div>
                )}
                <div className='absolute top-4 right-4 flex items-center h-[30px]'>
                  {aboutLink}
                </div>
                <HeaderLogo current='list' />
              </div>

              {/* One sticky block for both layouts' controls and the count
                  line, so a graph's filter chips (and Edit/Delete on desktop) stay in view
                  while the list scrolls. On desktop it stays below the top
                  bar (z-20) so the graph picker's menu draws over it. */}
              <div className='sticky top-0 z-20 md:z-10 bg-neutral-950'>
                <div className='hidden md:block'>
                  {subgraphTitle}
                  {recipeSummary}
                  {filterBar}
                </div>

                {/* Phones: search with the Filters toggle, then the count
                    line; list modes and the graph live in the bottom bar */}
                <div className='md:hidden'>
                  <div className='px-4 pt-2 pb-1 flex items-center gap-2'>
                    {isBrowsing ? searchControls : subgraphSearchControls}
                    {filterBar && filterToggleButton}
                  </div>
                  {recipeSummary}
                </div>

                {isBrowsing &&
                  !semantic &&
                  papers &&
                  (total > 0 || isMatches) && (
                    <div
                      className={`px-4 py-1.5 text-xs text-neutral-500 flex gap-x-2 ${isMatches ? 'items-start leading-5' : 'flex-wrap items-center gap-y-1'}`}
                    >
                      {isMatches ? (
                        <>
                          {/* Badges flow inline so a long recipe clamps to
                              two lines with an ellipsis; the full list is in
                              the tooltip */}
                          <p
                            className='min-w-0 line-clamp-1 md:line-clamp-2'
                            title={recipeLabels.join(', ') || undefined}
                          >
                            <span className='mr-1.5'>
                              {total.toLocaleString()}{' '}
                              {total === 1 ? 'paper' : 'papers'}
                              {/* Phones get one line, so with filters to show
                                  the chips follow a bare colon */}
                              {recipeLabels.length > 0 ? (
                                <>
                                  <span className='md:hidden'>:</span>
                                  <span className='hidden md:inline'>
                                    {matchesPhrase}
                                  </span>
                                </>
                              ) : (
                                matchesPhrase
                              )}
                            </span>
                            {recipeLabels.map((label) => (
                              <span
                                key={label}
                                className='inline-block mr-1.5 px-1.5 leading-4 rounded-full border border-neutral-700'
                              >
                                {label}
                              </span>
                            ))}
                          </p>
                          {recipeActions}
                        </>
                      ) : (
                        <span>
                          {total.toLocaleString()}{' '}
                          {total === 1 ? 'paper' : 'papers'}
                        </span>
                      )}
                      {batchNote}
                      {isFiltering && (
                        <span className='h-3 w-3 shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin' />
                      )}
                      {/* The modal starts from these filters (browseFilters),
                          so offer it while they're set. A keyword search
                          isn't part of a graph, so with one typed the count
                          wouldn't match what gets saved. */}
                      {!isMatches && hasActiveFilters && !query.trim() && (
                        <button
                          type='button'
                          onClick={openNewGraph}
                          className='ml-auto flex items-center gap-1 text-[#4ea8de] hover:text-[#6bb8e6] underline underline-offset-2 cursor-pointer'
                        >
                          <Plus size={11} />
                          Save these filters as a graph
                        </button>
                      )}
                    </div>
                  )}

                {isBrowsing && semantic && semanticResults && (
                  <div className='px-4 py-1.5 text-xs text-neutral-500 flex items-center gap-2'>
                    <span>{semanticResults.length} semantic results</span>
                    {batchNote}
                  </div>
                )}

                {!isBrowsing && subgraphNodes && subgraphNodes.length > 0 && (
                  <div className='px-4 py-1.5 text-xs text-neutral-500 flex items-center gap-x-2'>
                    <span className='flex-1 min-w-0'>
                      Showing {subgraphItems.length} of {subgraphNodes.length}{' '}
                      pinned papers
                    </span>
                    {recipeActions}
                  </div>
                )}

                {/* Edit/Delete normally ride on the count line; keep them
                    reachable while it's absent (loading, a failed fetch, no
                    pins yet) */}
                {showGraphActions && !graphActionsInline && (
                  <div className='hidden md:flex px-4 py-1.5 text-xs justify-end'>
                    {recipeActions}
                  </div>
                )}
              </div>

              {isBrowsing && !semantic && error && (!isMatches || recipe) && (
                <p className='p-4 text-red-400'>{error}</p>
              )}

              {isBrowsing && !semantic && !papers && (!isMatches || recipe) && (
                <LoadingIndicator label='Loading Papers…' />
              )}

              {isBrowsing && !semantic && papers && items.length === 0 && (
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

      {bottomBar}
      {graphSheet}

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
