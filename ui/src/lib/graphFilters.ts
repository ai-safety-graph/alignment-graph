import { DATE_PRESETS, presetToFromDate } from '../hooks/useServerFilters'
import type { DatePreset } from '../hooks/useServerFilters'
import { domainLabel } from './domain'

// The recipe a generated graph is built from. The date window is kept as a
// relative preset, so re-running a saved recipe ("past month") moves with time.
export type GraphFilters = {
  tags: string[]
  domains: string[]
  datePreset: DatePreset
  // Only papers known to be peer-reviewed. Optional: recipes saved before
  // the toggle existed don't have it and mean "all papers".
  peerReviewed?: boolean
}

export const EMPTY_FILTERS: GraphFilters = {
  tags: [],
  domains: [],
  datePreset: 'all',
}

// Params for fetchGraphRange / fetchPapers (same WHERE clause server-side).
export function toRangeParams(f: GraphFilters): {
  from?: string
  tags: string[]
  domains: string[]
  peerReviewed: boolean
} {
  return {
    from: presetToFromDate(f.datePreset),
    tags: f.tags,
    domains: f.domains,
    peerReviewed: f.peerReviewed ?? false,
  }
}

// One label per filter in a recipe, for showing it as chips
export function filterLabels(f: GraphFilters): string[] {
  return [
    ...f.tags,
    ...f.domains.map(domainLabel),
    ...(f.datePreset === 'all'
      ? []
      : [
          DATE_PRESETS.find((p) => p.value === f.datePreset)?.label ??
            f.datePreset,
        ]),
    ...(f.peerReviewed ? ['Peer-reviewed'] : []),
  ]
}

// e.g. "Interpretability and explainability +1 · past month · peer-reviewed"
export function defaultGraphName(f: GraphFilters, maxLength: number): string {
  const subject =
    f.tags.length > 0
      ? f.tags[0] + (f.tags.length > 1 ? ` +${f.tags.length - 1}` : '')
      : f.domains.length > 0
        ? f.domains.map(domainLabel).join(', ')
        : 'All papers'
  const parts = [subject.charAt(0).toUpperCase() + subject.slice(1)]
  if (f.datePreset !== 'all') {
    const label = DATE_PRESETS.find((p) => p.value === f.datePreset)?.label
    if (label) parts.push(label.toLowerCase())
  }
  if (f.peerReviewed) parts.push('peer-reviewed')
  const name = parts.join(' · ')
  return name.length > maxLength ? name.slice(0, maxLength - 1) + '…' : name
}
