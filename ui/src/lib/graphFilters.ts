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
  // Free-text facets, each "any of" and ANDed with the rest: keywords match a
  // word start in the title or abstract, authors a whole author name.
  // Optional for the same reason; absent or empty means no filter.
  keywords?: string[]
  authors?: string[]
}

// Limits the API enforces too (api/recipe.py). Keywords need a trigram to be
// served by the text index, and author suggestions start at the same length.
export const MIN_TERM_LENGTH = 3
export const MAX_TERMS = 10
export const MAX_TERM_LENGTH = 80

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
  keywords: string[]
  authors: string[]
} {
  return {
    from: presetToFromDate(f.datePreset),
    tags: f.tags,
    domains: f.domains,
    peerReviewed: f.peerReviewed ?? false,
    keywords: f.keywords ?? [],
    authors: f.authors ?? [],
  }
}

export const keywordLabel = (k: string) => `“${k}”`
export const authorLabel = (a: string) => `by ${a}`

// One label per filter in a recipe, for showing it as chips
export function filterLabels(f: GraphFilters): string[] {
  return [
    ...(f.authors ?? []).map(authorLabel),
    ...(f.keywords ?? []).map(keywordLabel),
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

// A short form of a recipe for the graph view's bottom bar: peer review and
// the date window if set, then the authors and keywords (one in full, more as
// a count), then how many topics. filterLabels has the lot.
export function filterSummary(f: GraphFilters): string[] {
  const date =
    f.datePreset === 'all'
      ? null
      : (DATE_PRESETS.find((p) => p.value === f.datePreset)?.label ??
        f.datePreset)
  return [
    ...(f.peerReviewed ? ['Peer-reviewed'] : []),
    ...(date ? [date] : []),
    ...countOrOne(f.authors ?? [], authorLabel, 'authors'),
    ...countOrOne(f.keywords ?? [], keywordLabel, 'keywords'),
    ...(f.tags.length > 0
      ? [`${f.tags.length} ${f.tags.length === 1 ? 'topic' : 'topics'}`]
      : []),
  ]
}

// One item in full, several as a count ("3 authors")
function countOrOne(
  items: string[],
  label: (s: string) => string,
  plural: string,
): string[] {
  if (items.length === 0) return []
  return [items.length === 1 ? label(items[0]) : `${items.length} ${plural}`]
}

const firstPlus = (items: string[], fmt: (s: string) => string = (s) => s) =>
  fmt(items[0]) + (items.length > 1 ? ` +${items.length - 1}` : '')

// e.g. "Interpretability and explainability +1 · past month · peer-reviewed",
// or "Neel Nanda · “sparse autoencoder”". Authors and keywords lead, as the
// most specific facets; tags follow, then domains when nothing else names it.
export function defaultGraphName(f: GraphFilters, maxLength: number): string {
  const authors = f.authors ?? []
  const keywords = f.keywords ?? []
  const named = [
    ...(authors.length > 0 ? [firstPlus(authors)] : []),
    ...(keywords.length > 0 ? [firstPlus(keywords, keywordLabel)] : []),
  ]
  const subject =
    named.length > 0
      ? named.join(' · ')
      : f.tags.length > 0
        ? firstPlus(f.tags)
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
