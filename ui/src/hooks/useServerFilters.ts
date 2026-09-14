import { useMemo, useState } from 'react'
import type { ClustersLegend } from '../lib/types'

export type DatePreset =
  | '1w'
  | '2w'
  | '3w'
  | '1m'
  | '3m'
  | '6m'
  | '1y'
  | '2y'
  | '3y'
  | 'all'

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1w', label: '1 Week' },
  { value: '2w', label: '2 Weeks' },
  { value: '3w', label: '3 Weeks' },
  { value: '1m', label: '1 Month' },
  { value: '3m', label: '3 Months' },
  { value: '6m', label: '6 Months' },
  { value: '1y', label: '1 Year' },
  { value: '2y', label: '2 Years' },
  { value: '3y', label: '3 Years' },
]

function presetToFromDate(preset: DatePreset): string | undefined {
  if (preset === 'all') return undefined
  const d = new Date()
  if (preset === '1w') d.setDate(d.getDate() - 7)
  else if (preset === '2w') d.setDate(d.getDate() - 14)
  else if (preset === '3w') d.setDate(d.getDate() - 21)
  else if (preset === '1m') d.setMonth(d.getMonth() - 1)
  else if (preset === '3m') d.setMonth(d.getMonth() - 3)
  else if (preset === '6m') d.setMonth(d.getMonth() - 6)
  else if (preset === '1y') d.setFullYear(d.getFullYear() - 1)
  else if (preset === '2y') d.setFullYear(d.getFullYear() - 2)
  else if (preset === '3y') d.setFullYear(d.getFullYear() - 3)
  return d.toISOString().split('T')[0]
}

export function useServerFilters(clusters: ClustersLegend) {
  const [activeCids, setActiveCids] = useState<Set<number>>(new Set())
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set())
  const [datePreset, setDatePreset] = useState<DatePreset>('all')

  const clusterEntries = useMemo(
    () =>
      Object.entries(clusters) as Array<
        [string, { label?: string | null; size: number }]
      >,
    [clusters],
  )

  const fromDate = useMemo(() => presetToFromDate(datePreset), [datePreset])

  const hasActiveFilters =
    activeCids.size > 0 || activeDomains.size > 0 || datePreset !== 'all'

  function clearAllFilters() {
    setActiveCids(new Set())
    setActiveDomains(new Set())
    setDatePreset('all')
  }

  function toggleCluster(cid: number) {
    setActiveCids((prev) => {
      const next = new Set(prev)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
      return next
    })
  }

  function toggleDomain(dm: string) {
    setActiveDomains((prev) => {
      const next = new Set(prev)
      if (next.has(dm)) next.delete(dm)
      else next.add(dm)
      return next
    })
  }

  return {
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
  }
}
