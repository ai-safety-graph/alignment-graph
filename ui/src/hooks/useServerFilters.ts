import { useMemo, useState } from 'react'
import type { ClustersLegend } from '../lib/types'

export type DatePreset = '1m' | '3m' | '1y' | 'all'

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

function presetToFromDate(preset: DatePreset): string | undefined {
  if (preset === 'all') return undefined
  const d = new Date()
  if (preset === '1m') d.setMonth(d.getMonth() - 1)
  else if (preset === '3m') d.setMonth(d.getMonth() - 3)
  else if (preset === '1y') d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().split('T')[0]
}

export function useServerFilters(clusters: ClustersLegend) {
  const [activeCids, setActiveCids] = useState<Set<number>>(new Set())
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set())
  const [datePreset, setDatePreset] = useState<DatePreset>('3m')

  const clusterEntries = useMemo(
    () =>
      Object.entries(clusters) as Array<
        [string, { label?: string | null; size: number }]
      >,
    [clusters],
  )

  const fromDate = useMemo(() => presetToFromDate(datePreset), [datePreset])

  const hasActiveFilters =
    activeCids.size > 0 || activeDomains.size > 0 || datePreset !== '3m'

  function clearAllFilters() {
    setActiveCids(new Set())
    setActiveDomains(new Set())
    setDatePreset('3m')
  }

  function toggleCluster(cid: number) {
    setActiveCids((prev) => {
      const next = new Set(prev)
      next.has(cid) ? next.delete(cid) : next.add(cid)
      return next
    })
  }

  function toggleDomain(dm: string) {
    setActiveDomains((prev) => {
      const next = new Set(prev)
      next.has(dm) ? next.delete(dm) : next.add(dm)
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
