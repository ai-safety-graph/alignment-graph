import { useMemo, useState } from 'react'
import type { TagsLegend } from '../lib/types'

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
  { value: '1w', label: 'Past week' },
  { value: '2w', label: 'Past 2 weeks' },
  { value: '3w', label: 'Past 3 weeks' },
  { value: '1m', label: 'Past month' },
  { value: '3m', label: 'Past 3 months' },
  { value: '6m', label: 'Past 6 months' },
  { value: '1y', label: 'Past year' },
  { value: '2y', label: 'Past 2 years' },
  { value: '3y', label: 'Past 3 years' },
  // Widest window last so the slider grows monotonically left → right
  { value: 'all', label: 'Any time' },
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
