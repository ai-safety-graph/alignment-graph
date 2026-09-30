import { useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { RotateCcw } from 'lucide-react'
import { tagIcon } from '../lib/tags'
import { domainLabel } from '../lib/domain'
import { DATE_PRESETS } from '../hooks/useServerFilters'
import type { DatePreset } from '../hooks/useServerFilters'

interface FilterBarProps {
  tagEntries: Array<[string, { size: number }]>
  availableDomains: string[]
  isLoading?: boolean
  activeTags: Set<string>
  activeDomains: Set<string>
  hasActiveFilters: boolean
  onToggleTag: (tag: string) => void
  onToggleDomain: (domain: string) => void
  onClearAll: () => void
  // Year chips (MobileView / legacy)
  availableYears?: number[]
  activeYear?: number | null
  onToggleYear?: (year: number) => void
  // Date preset chips (StatsView)
  datePreset?: DatePreset
  onSetDatePreset?: (preset: DatePreset) => void
  // Slider notches; defaults to every preset
  datePresets?: typeof DATE_PRESETS
  isExpanded?: boolean
  showTagCounts?: boolean
}

function DateSlider({
  value,
  presets,
  onCommit,
}: {
  value: DatePreset
  presets: typeof DATE_PRESETS
  onCommit: (preset: DatePreset) => void
}) {
  const lastIndex = presets.length - 1
  const foundIndex = presets.findIndex((p) => p.value === value)
  // A preset missing from the list is wider than the data, i.e. "Any time"
  const committedIndex = foundIndex === -1 ? lastIndex : foundIndex
  // Tracks the thumb while dragging; the filter itself only updates on commit
  // so StatsView doesn't refetch at every notch.
  const [pendingIndex, setPendingIndex] = useState(committedIndex)
  const [prevCommitted, setPrevCommitted] = useState(committedIndex)
  if (committedIndex !== prevCommitted) {
    // Sync external changes (e.g. Clear Filters)
    setPrevCommitted(committedIndex)
    setPendingIndex(committedIndex)
  }

  return (
    <div className='flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2'>
      <span
        id='date-filter-label'
        className='shrink-0 text-xs text-neutral-500 md:w-24'
      >
        Published
      </span>
      <div className='flex flex-1 items-center gap-2'>
        <Slider.Root
          min={0}
          max={lastIndex}
          step={1}
          value={[pendingIndex]}
          onValueChange={([i]) => setPendingIndex(i)}
          onValueCommit={([i]) => onCommit(presets[i].value)}
          className='relative flex flex-1 md:max-w-md lg:max-w-xl h-5 items-center touch-none select-none cursor-pointer'
        >
          <Slider.Track className='relative h-0.5 grow rounded-full bg-neutral-600'>
            <Slider.Range className='absolute h-full rounded-full bg-neutral-400' />
          </Slider.Track>
          {/* Notches: inset by half the 12px thumb so they line up with its centre at each step */}
          {presets.map((p, i) => (
            <span
              key={p.value}
              className='pointer-events-none absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-neutral-500'
              style={{
                left: `calc(6px + (100% - 12px) * ${i / lastIndex})`,
              }}
              aria-hidden
            />
          ))}
          <Slider.Thumb
            aria-labelledby='date-filter-label'
            aria-valuetext={presets[pendingIndex]?.label}
            className='block size-3 rounded-full bg-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400'
          />
        </Slider.Root>
        <span className='shrink-0 w-20 md:w-24 text-right text-xs text-neutral-300'>
          {presets[pendingIndex]?.label}
        </span>
      </div>
    </div>
  )
}

export default function FilterBar({
  tagEntries,
  availableDomains,
  isLoading = false,
  activeTags,
  activeDomains,
  hasActiveFilters,
  onToggleTag,
  onToggleDomain,
  onClearAll,
  availableYears,
  activeYear,
  onToggleYear,
  datePreset,
  onSetDatePreset,
  datePresets = DATE_PRESETS,
  isExpanded = true,
  showTagCounts = true,
}: FilterBarProps) {
  if (!isExpanded) return null

  return (
    <div className='w-full my-2 rounded-lg border border-neutral-700 bg-neutral-950'>
      <div className='px-5 py-3 space-y-2'>
        <div className='flex items-center justify-between gap-2'>
          <div className='text-xs font-medium text-neutral-400'>Filter by</div>
          <button
            onClick={onClearAll}
            disabled={!hasActiveFilters}
            className='flex items-center gap-1 px-3 py-1 rounded-md border bg-neutral-950 border-neutral-700 text-xs text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:text-neutral-700 disabled:hover:text-neutral-700 disabled:hover:border-neutral-700 disabled:cursor-not-allowed'
          >
            Clear Filters
            <RotateCcw size={13} />
          </button>
        </div>

        {datePreset !== undefined &&
          onSetDatePreset &&
          datePresets.length > 1 && (
            <DateSlider
              value={datePreset}
              presets={datePresets}
              onCommit={onSetDatePreset}
            />
          )}

        {!datePreset &&
          availableYears &&
          availableYears.length > 0 &&
          onToggleYear && (
            <div className='flex flex-col gap-1.5 md:flex-row md:items-start md:gap-2'>
              <span className='shrink-0 text-xs text-neutral-500 md:w-24 md:pt-1'>
                Year
              </span>
              <div className='flex flex-wrap gap-2'>
                {availableYears.map((year) => (
                  <button
                    key={year}
                    onClick={() => onToggleYear(year)}
                    className={`px-3 py-1 rounded-md border text-xs whitespace-nowrap ${
                      activeYear === year
                        ? 'bg-neutral-600 border-neutral-500 text-white'
                        : 'bg-neutral-950 border-neutral-700 hover:border-neutral-500'
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>
          )}

        {(isLoading || availableDomains.length > 0) && (
          <div className='flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2'>
            <span className='shrink-0 text-xs text-neutral-500 md:w-24'>
              arXiv domain:
            </span>
            <div className='flex min-w-0 items-center gap-2 overflow-x-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent'>
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <span
                      key={i}
                      className='shrink-0 h-6 w-16 rounded-md bg-neutral-800 animate-pulse'
                      aria-hidden
                    />
                  ))
                : availableDomains.map((dm) => (
                    <button
                      key={dm}
                      onClick={() => onToggleDomain(dm)}
                      className={`shrink-0 px-3 py-1 rounded-md border text-xs whitespace-nowrap ${
                        activeDomains.has(dm)
                          ? 'bg-neutral-600 border-neutral-500 text-white'
                          : 'bg-neutral-950 border-neutral-700 hover:border-neutral-500'
                      }`}
                    >
                      {domainLabel(dm)}
                    </button>
                  ))}
            </div>
          </div>
        )}

        <div className='flex flex-col gap-1.5 md:flex-row md:items-start md:gap-2'>
          <span className='shrink-0 text-xs text-neutral-500 md:w-24 md:pt-1'>
            Tags
          </span>
          <div className='flex flex-wrap gap-2'>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={i}
                    className='h-6 w-20 rounded-md bg-neutral-800 animate-pulse'
                    aria-hidden
                  />
                ))
              : tagEntries.map(([tag, meta]) => {
                  const Icon = tagIcon(tag)
                  const active = activeTags.has(tag)
                  return (
                    <button
                      key={tag}
                      onClick={() => onToggleTag(tag)}
                      className={`inline-flex items-center px-3 py-1 rounded-md border text-xs whitespace-nowrap ${
                        active
                          ? 'bg-neutral-800 border-neutral-500'
                          : 'bg-neutral-950 border-neutral-700 hover:border-neutral-500'
                      }`}
                    >
                      <Icon
                        size={12}
                        className={`shrink-0 mr-1.5 ${active ? 'text-[#4ea8de]' : ''}`}
                        aria-hidden
                      />
                      {showTagCounts ? tag + ' • ' + meta.size : tag}
                    </button>
                  )
                })}
          </div>
        </div>
      </div>
    </div>
  )
}
