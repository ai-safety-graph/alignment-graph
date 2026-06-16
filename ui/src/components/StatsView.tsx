import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { Share2, Search, Trash } from 'lucide-react'
import StatsPaperDetails from './StatsPaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import FilterBar from './FilterBar'
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

  const { selectedId, navHistory, selectFromList, selectRelated, navigateTo, close } = useNavHistory()
  const selected = usePaperDetail(selectedId)
  const { neighbors, loading: neighborsLoading } = useRelatedPapers(selectedId)

  const listRef = useRef<HTMLDivElement | null>(null)
  const autoSelectedRef = useRef(false)

  // Auto-select the first paper once results first arrive.
  useEffect(() => {
    if (!autoSelectedRef.current && papers && papers.length > 0 && selectedId === null) {
      autoSelectedRef.current = true
      selectFromList(papers[0].aid)
    }
  }, [papers, selectedId, selectFromList])

  const items = useMemo(() => (papers ?? []).map((n) => ({ n })), [papers])

  // Reset list scroll when the result set changes.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [items])

  // Lock background scroll while the mobile detail modal is open.
  useEffect(() => {
    if (!selected) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [selected])

  const handleSelectRelated = (aid: string) =>
    selectRelated(selected ? { aid: selected.aid, title: selected.t } : null, aid)

  const resetKey = `${debouncedQuery}|${fromDate ?? ''}|${[...activeCids].sort()}|${[...activeDomains].sort()}`

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      {/* Top: full-width search bar, centered */}
      <div className='shrink-0 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur px-3 py-3 flex items-center gap-3'>
        <Link
          to='/'
          className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
          aria-label='Back to graph'
        >
          <Share2 size={18} />
        </Link>
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
          {papers && (
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
            {papers && total > 0 && (
              <div className='px-4 py-1.5 text-xs text-neutral-500'>
                Showing {papers.length} of {total.toLocaleString()} papers
              </div>
            )}

            {error && <p className='p-4 text-red-400'>{error}</p>}

            {!papers && (
              <div className='flex h-[60vh] items-center justify-center text-neutral-400'>
                Loading…
              </div>
            )}

            {papers && items.length === 0 && (
              <div className='p-6 text-center text-neutral-400'>
                No matches.
              </div>
            )}

            <PaperList
              items={items}
              clusters={clusters}
              onSelectId={selectFromList}
              enableHover
              resetKey={resetKey}
              hasMore={hasMore}
              onLoadMore={loadMore}
              selectedId={selectedId ?? undefined}
            />
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
