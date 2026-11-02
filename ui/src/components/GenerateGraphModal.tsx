import { useEffect, useMemo, useRef } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'

import FilterBar from './FilterBar'
import { fetchPapers } from '../lib/api'
import { toRangeParams } from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useServerFilters } from '../hooks/useServerFilters'
import { useTagCatalog } from '../hooks/useTagCatalog'

// Mirrors the backend's _MAX_RANGE: generated graphs keep the newest papers.
const MAX_GRAPH_PAPERS = 500

export default function GenerateGraphModal({
  initialFilters,
  mode,
  onGenerate,
  onClose,
}: {
  initialFilters: GraphFilters
  mode: 'generate' | 'edit'
  onGenerate: (filters: GraphFilters) => void
  onClose: () => void
}) {
  const { tags, availableDomains, isLoading } = useTagCatalog()
  const {
    datePreset,
    setDatePreset,
    activeTags,
    activeDomains,
    tagEntries,
    hasActiveFilters,
    clearAllFilters,
    toggleTag,
    toggleDomain,
  } = useServerFilters(tags, initialFilters)

  const filters = useMemo<GraphFilters>(
    () => ({
      tags: [...activeTags],
      domains: [...activeDomains],
      datePreset,
    }),
    [activeTags, activeDomains, datePreset],
  )

  // Live match count: /api/papers applies the same filters as /api/graph/range,
  // so a one-row page carries the total without fetching the graph.
  const debouncedFilters = useDebouncedValue(filters, 250)
  const { data: total, isFetching: isCounting } = useQuery({
    queryKey: ['graphCount', debouncedFilters],
    queryFn: async () =>
      (await fetchPapers({ ...toRangeParams(debouncedFilters), limit: 1 }))
        .total,
    placeholderData: keepPreviousData,
  })
  const isPending = isCounting || debouncedFilters !== filters
  const canGenerate = total !== undefined && total > 0 && !isPending

  const panelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const generate = () => {
    if (canGenerate) onGenerate(filters)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (
      e.key === 'Enter' &&
      !(e.target as HTMLElement).closest('button, [role="slider"]')
    ) {
      e.preventDefault()
      generate()
    }
  }

  let countLabel = 'Counting papers…'
  if (total !== undefined) {
    countLabel =
      total > MAX_GRAPH_PAPERS
        ? `${total.toLocaleString()} papers match · the graph shows the newest ${MAX_GRAPH_PAPERS}`
        : `${total.toLocaleString()} ${total === 1 ? 'paper matches' : 'papers match'}`
  }

  return (
    <div
      className='fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4'
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='generate-graph-title'
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className='w-full max-w-[760px] max-h-[85vh] flex flex-col rounded-lg border border-neutral-700 bg-neutral-950 shadow-lg outline-none'
      >
        <div className='flex items-start justify-between gap-4 px-5 pt-4'>
          <div>
            <h2
              id='generate-graph-title'
              className='text-base font-medium text-neutral-100'
            >
              {mode === 'edit' ? 'Edit graph' : 'Generate a graph'}
            </h2>
            <p className='mt-1 text-sm text-neutral-400'>
              Pick the topics you care about to map their papers. Nearby papers
              cover similar topics.
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='shrink-0 p-1 rounded-md text-neutral-400 hover:text-white cursor-pointer'
          >
            <X size={16} />
          </button>
        </div>

        <div className='min-h-0 overflow-auto px-0'>
          <FilterBar
            tagEntries={tagEntries}
            availableDomains={availableDomains}
            isLoading={isLoading}
            activeTags={activeTags}
            activeDomains={activeDomains}
            datePreset={datePreset}
            hasActiveFilters={hasActiveFilters}
            onToggleTag={toggleTag}
            onToggleDomain={toggleDomain}
            onSetDatePreset={setDatePreset}
            onClearAll={clearAllFilters}
            bordered={false}
          />
        </div>

        <div className='flex items-center justify-between gap-4 px-5 py-3 border-t border-neutral-800'>
          <span
            aria-live='polite'
            className={`text-sm transition-opacity ${isPending ? 'opacity-60' : ''} ${total === 0 ? 'text-amber-400' : 'text-neutral-400'}`}
          >
            {total === 0 ? 'No papers match these filters' : countLabel}
          </span>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={onClose}
              className='px-3 py-1 rounded-md border border-neutral-700 text-sm text-neutral-300 hover:text-white hover:border-neutral-500 cursor-pointer'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={generate}
              disabled={!canGenerate}
              className='px-3 py-1 rounded-md bg-[#4ea8de] text-sm font-medium text-neutral-950 hover:bg-[#6bb8e6] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
            >
              {mode === 'edit' ? 'Regenerate graph' : 'Generate graph'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
