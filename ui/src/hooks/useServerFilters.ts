import { useMemo, useState } from 'react'
import type { TagsLegend } from '../lib/types'

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

export function useServerFilters(tags: TagsLegend) {
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set())
  const [datePreset, setDatePreset] = useState<DatePreset>('all')

  const tagEntries = useMemo(
    () => Object.entries(tags) as Array<[string, { size: number }]>,
    [tags],
  )

  const fromDate = useMemo(() => presetToFromDate(datePreset), [datePreset])

  const hasActiveFilters =
    activeTags.size > 0 || activeDomains.size > 0 || datePreset !== 'all'

  function clearAllFilters() {
    setActiveTags(new Set())
    setActiveDomains(new Set())
    setDatePreset('all')
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
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
    activeTags,
    activeDomains,
    tagEntries,
    hasActiveFilters,
    clearAllFilters,
    toggleTag,
    toggleDomain,
  }
}
