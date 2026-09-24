import { RotateCcw } from 'lucide-react'
import { tagToColor } from '../lib/colors'
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
  isExpanded?: boolean
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
  isExpanded = true,
}: FilterBarProps) {
  if (!isExpanded) return null

  const dateIndex =
    datePreset !== undefined
      ? DATE_PRESETS.findIndex((p) => p.value === datePreset)
      : -1

  return (
    <div className='w-full my-2 rounded-lg border border-neutral-700 bg-[#1f1f1f]'>
      <div className='px-5 py-3 space-y-2'>
        <div className='text-xs font-medium text-neutral-400'>Filter by</div>

        {datePreset !== undefined && onSetDatePreset && (
          <div className='flex items-center gap-2'>
            <span className='shrink-0 text-xs text-neutral-500 w-24'>
              Date
            </span>
            <input
              type='range'
              min={0}
              max={DATE_PRESETS.length - 1}
              step={1}
              value={dateIndex}
              onChange={(e) =>
                onSetDatePreset(DATE_PRESETS[+e.target.value].value)
              }
              className='date-slider flex-1 max-w-xs'
            />
            <span className='shrink-0 w-20 text-right text-xs text-neutral-300'>
              {DATE_PRESETS[dateIndex]?.label}
            </span>
          </div>
        )}

        {!datePreset &&
          availableYears &&
          availableYears.length > 0 &&
          onToggleYear && (
            <div className='flex items-start gap-2'>
              <span className='shrink-0 text-xs text-neutral-500 w-24 pt-1'>
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
                        : 'bg-transparent border-neutral-700 hover:border-neutral-500'
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>
          )}

        {(isLoading || availableDomains.length > 0) && (
          <div className='flex items-center gap-2 overflow-x-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent'>
            <span className='shrink-0 text-xs text-neutral-500 w-24'>
              arXiv domain:
            </span>
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
                        : 'bg-transparent border-neutral-700 hover:border-neutral-500'
                    }`}
                  >
                    {domainLabel(dm)}
                  </button>
                ))}
          </div>
        )}

        <div className='flex items-start gap-2'>
          <span className='shrink-0 text-xs text-neutral-500 w-24 pt-1'>
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
              : tagEntries.map(([tag, meta]) => (
                  <button
                    key={tag}
                    onClick={() => onToggleTag(tag)}
                    className={`px-3 py-1 rounded-md border text-xs whitespace-nowrap ${
                      activeTags.has(tag)
                        ? 'bg-neutral-800 border-neutral-500'
                        : 'bg-transparent border-neutral-700 hover:border-neutral-500'
                    }`}
                  >
                    <span
                      className='inline-block w-2 h-2 mr-2 rounded-full border border-[#333333]'
                      style={{ backgroundColor: tagToColor(tag) }}
                      aria-hidden
                    />
                    {tag + ' • ' + meta.size}
                  </button>
                ))}
          </div>
        </div>

        <div className='flex items-start gap-2'>
          <span className='shrink-0 w-24' aria-hidden />
          <button
            onClick={onClearAll}
            disabled={!hasActiveFilters}
            className='flex items-center gap-1 px-3 py-1 rounded-md border bg-transparent border-neutral-700 text-xs text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:text-neutral-700 disabled:hover:text-neutral-700 disabled:hover:border-neutral-700 disabled:cursor-not-allowed'
          >
            Clear Filters
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
