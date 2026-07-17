import { RotateCcw } from 'lucide-react'
import { cidToColor } from '../lib/colors'
import { domainLabel } from '../lib/domain'
import { DATE_PRESETS } from '../hooks/useServerFilters'
import type { DatePreset } from '../hooks/useServerFilters'

interface FilterBarProps {
  clusterEntries: Array<[string, { label?: string | null; size: number }]>
  availableDomains: string[]
  isLoading?: boolean
  activeCids: Set<number>
  activeDomains: Set<string>
  hasActiveFilters: boolean
  onToggleCluster: (cid: number) => void
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
  clusterEntries,
  availableDomains,
  isLoading = false,
  activeCids,
  activeDomains,
  hasActiveFilters,
  onToggleCluster,
  onToggleDomain,
  onClearAll,
  availableYears,
  activeYear,
  onToggleYear,
  datePreset,
  onSetDatePreset,
  isExpanded = true,
}: FilterBarProps) {
  return (
    <div className='w-full overflow-hidden'>
      <div
        className={`w-full my-2 overflow-hidden transition-colors duration-200 ${
          isExpanded ? 'bg-[#1f1f1f]' : 'bg-neutral-950'
        }`}
      >
        {isExpanded && (
          <div className='px-3 py-3 space-y-2'>
            <div className='text-xs font-medium text-neutral-400'>
              Filter by
            </div>

            {datePreset !== undefined && onSetDatePreset && (
              <div className='flex items-center gap-2'>
                <span className='shrink-0 text-xs text-neutral-500 w-12'>
                  Date
                </span>
                <div className='flex gap-2'>
                  {DATE_PRESETS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => onSetDatePreset(value)}
                      className={`px-3 py-1 rounded-md border text-xs whitespace-nowrap ${
                        datePreset === value
                          ? 'bg-neutral-600 border-neutral-500 text-white'
                          : 'bg-neutral-950 border-neutral-700 hover:border-neutral-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!datePreset &&
              availableYears &&
              availableYears.length > 0 &&
              onToggleYear && (
                <div className='flex items-start gap-2'>
                  <span className='shrink-0 text-xs text-neutral-500 w-12 pt-1'>
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
              <div className='flex items-center gap-2 overflow-x-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'>
                <span className='shrink-0 text-xs text-neutral-500 w-12'>
                  Domain
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
                            : 'bg-neutral-950 border-neutral-700 hover:border-neutral-500'
                        }`}
                      >
                        {domainLabel(dm)}
                      </button>
                    ))}
              </div>
            )}

            <div className='flex items-start gap-2'>
              <span className='shrink-0 text-xs text-neutral-500 w-12 pt-1'>
                Cluster
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
                  : clusterEntries.map(([cid, meta]) => (
                      <button
                        key={cid}
                        onClick={() => onToggleCluster(+cid)}
                        className={`px-3 py-1 rounded-md border text-xs whitespace-nowrap ${
                          activeCids.has(+cid)
                            ? 'bg-neutral-800 border-neutral-500'
                            : 'bg-neutral-950 border-neutral-700 hover:border-neutral-500'
                        }`}
                      >
                        <span
                          className='inline-block w-2 h-2 mr-2 rounded-full border border-[#333333]'
                          style={{ backgroundColor: cidToColor(Number(cid)) }}
                          aria-hidden
                        />
                        {(meta.label ?? `Cluster ${cid}`) + ' • ' + meta.size}
                      </button>
                    ))}
              </div>
            </div>

            <div className='flex items-start gap-2'>
              <span className='shrink-0 w-12' aria-hidden />
              <button
                onClick={onClearAll}
                disabled={!hasActiveFilters}
                className='flex items-center gap-1 px-3 py-1 rounded-md border bg-neutral-950 border-neutral-700 text-xs text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:text-neutral-700 disabled:hover:text-neutral-700 disabled:hover:border-neutral-700 disabled:cursor-not-allowed'
              >
                Clear Filters
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
