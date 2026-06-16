import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cidToColor } from '../lib/colors'
import { DATE_PRESETS } from '../hooks/useServerFilters'
import type { DatePreset } from '../hooks/useServerFilters'

interface FilterBarProps {
  clusterEntries: Array<[string, { label?: string | null; size: number }]>
  availableDomains: string[]
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
}

export default function FilterBar({
  clusterEntries,
  availableDomains,
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
}: FilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const activeCount =
    activeCids.size + (activeYear != null ? 1 : 0) + activeDomains.size

  return (
    <div className='w-full overflow-hidden'>
      <div className='flex items-center justify-between px-4 pt-2 pb-1'>
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className='flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300'
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Filters
          {!isExpanded && activeCount > 0 && (
            <span className='ml-1 px-1.5 py-0.5 rounded-full bg-neutral-700 text-neutral-300 text-[10px] leading-none'>
              {activeCount}
            </span>
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={onClearAll}
            className='text-xs text-neutral-400 hover:text-neutral-200'
          >
            Clear all
          </button>
        )}
      </div>

      {isExpanded && (
        <>
          {datePreset !== undefined && onSetDatePreset && (
            <div className='flex items-center gap-2 px-4 pt-1 pb-1'>
              <span className='shrink-0 text-xs text-neutral-500 w-12'>Date</span>
              <div className='flex gap-2'>
                {DATE_PRESETS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onSetDatePreset(value)}
                    className={`px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
                      datePreset === value
                        ? 'bg-neutral-600 border-neutral-500 text-white'
                        : 'border-neutral-700 hover:border-neutral-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!datePreset && availableYears && availableYears.length > 0 && onToggleYear && (
            <div className='flex items-start gap-2 px-4 pt-1 pb-1'>
              <span className='shrink-0 text-xs text-neutral-500 w-12 pt-1'>Year</span>
              <div className='flex flex-wrap gap-2'>
                {availableYears.map((year) => (
                  <button
                    key={year}
                    onClick={() => onToggleYear(year)}
                    className={`px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
                      activeYear === year
                        ? 'bg-neutral-600 border-neutral-500 text-white'
                        : 'border-neutral-700 hover:border-neutral-500'
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableDomains.length > 0 && (
            <div className='flex items-center gap-2 overflow-x-auto px-4 pt-1 pb-1 scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'>
              <span className='shrink-0 text-xs text-neutral-500 w-12'>Domain</span>
              {availableDomains.map((dm) => (
                <button
                  key={dm}
                  onClick={() => onToggleDomain(dm)}
                  className={`shrink-0 px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
                    activeDomains.has(dm)
                      ? 'bg-neutral-600 border-neutral-500 text-white'
                      : 'border-neutral-700 hover:border-neutral-500'
                  }`}
                >
                  {dm}
                </button>
              ))}
            </div>
          )}

          <div className='flex items-start gap-2 px-4 pt-1 pb-2'>
            <span className='shrink-0 text-xs text-neutral-500 w-12 pt-1'>
              Cluster
            </span>
            <div className='flex flex-wrap gap-2'>
              {clusterEntries.map(([cid, meta]) => (
                <button
                  key={cid}
                  onClick={() => onToggleCluster(+cid)}
                  className={`px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
                    activeCids.has(+cid)
                      ? 'bg-neutral-800 border-neutral-500'
                      : 'border-neutral-700 hover:border-neutral-500'
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
        </>
      )}
    </div>
  )
}
