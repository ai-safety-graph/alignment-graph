import { cidToColor } from '../lib/colors'

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

interface FilterBarProps {
  clusterEntries: Array<[string, { label?: string | null; size: number }]>
  availableYears: number[]
  availableMonths: number[]
  availableDomains: string[]
  activeCids: Set<number>
  activeYear: number | null
  activeMonth: number | null
  activeDomains: Set<string>
  hasActiveFilters: boolean
  onToggleCluster: (cid: number) => void
  onToggleYear: (year: number) => void
  onToggleMonth: (month: number) => void
  onToggleDomain: (domain: string) => void
  onClearAll: () => void
}

export default function FilterBar({
  clusterEntries,
  availableYears,
  availableMonths,
  availableDomains,
  activeCids,
  activeYear,
  activeMonth,
  activeDomains,
  hasActiveFilters,
  onToggleCluster,
  onToggleYear,
  onToggleMonth,
  onToggleDomain,
  onClearAll,
}: FilterBarProps) {
  return (
    <>
      <div className='flex items-center justify-between px-4 pt-2 pb-1'>
        <span className='text-xs text-neutral-500'>Filters</span>
        {hasActiveFilters && (
          <button
            onClick={onClearAll}
            className='text-xs text-neutral-400 hover:text-neutral-200'
          >
            Clear all
          </button>
        )}
      </div>

      {availableYears.length > 0 && (
        <div className='flex items-center gap-2 overflow-x-auto px-4 pt-1 pb-1 scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'>
          <span className='shrink-0 text-xs text-neutral-500 w-12'>Year</span>
          {availableYears.map((year) => (
            <button
              key={year}
              onClick={() => onToggleYear(year)}
              className={`shrink-0 px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
                activeYear === year
                  ? 'bg-neutral-600 border-neutral-500 text-white'
                  : 'border-neutral-700 hover:border-neutral-500'
              }`}
            >
              {year}
            </button>
          ))}
        </div>
      )}

      {activeYear != null && availableMonths.length > 0 && (
        <div className='flex items-center gap-2 overflow-x-auto px-4 pt-1 pb-1 scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'>
          <span className='shrink-0 text-xs text-neutral-500 w-12'>Month</span>
          {availableMonths.map((m) => (
            <button
              key={m}
              onClick={() => onToggleMonth(m)}
              className={`shrink-0 px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
                activeMonth === m
                  ? 'bg-neutral-600 border-neutral-500 text-white'
                  : 'border-neutral-700 hover:border-neutral-500'
              }`}
            >
              {MONTH_NAMES[m - 1]}
            </button>
          ))}
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

      <div className='flex items-center gap-2 overflow-x-auto px-4 pt-1 pb-2 scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'>
        <span className='shrink-0 text-xs text-neutral-500 w-12'>Cluster</span>
        {clusterEntries.map(([cid, meta]) => (
          <button
            key={cid}
            onClick={() => onToggleCluster(+cid)}
            className={`shrink-0 px-3 py-1 rounded-full border text-xs whitespace-nowrap ${
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
    </>
  )
}
