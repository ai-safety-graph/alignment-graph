import { DATE_PRESETS } from '../hooks/useServerFilters'
import type { DatePreset } from '../hooks/useServerFilters'
import {
  defaultGraphName,
  MIN_TERM_LENGTH,
  MAX_TERM_LENGTH,
  MAX_TERMS,
  termLength,
  type GraphFilters,
} from './graphFilters'
import {
  MAX_GRAPH_NAME_LENGTH,
  MAX_HIDDEN,
  MAX_PINNED,
  type GraphMembership,
} from './storage'

// A graph as a share link carries it: a snapshot of its recipe (the date
// window stays a relative preset) and its pins and hides. No recipe means a
// graph of pins only.
export type SharedGraph = GraphMembership & {
  name: string
  filters?: GraphFilters
}

// Query keys, kept short since a link with many pins gets long. `v` marks a
// share link and versions the format.
const K = {
  version: 'v',
  name: 'n',
  tags: 't',
  domains: 'd',
  date: 'w',
  peerReviewed: 'pr',
  keywords: 'k',
  authors: 'a',
  pinned: 'p',
  hidden: 'h',
} as const
const VERSION = '1'
export const SHARE_PARAM_KEYS: readonly string[] = Object.values(K)

// Bounds on what a link may ask for. Tags and domains aren't checked against
// the catalog here: an unknown one just matches nothing.
const MAX_FACETS = 100
const MAX_FACET_LENGTH = 200

const ABS_PREFIX = 'https://arxiv.org/abs/'
// New-style (2401.12345) and old-style (cs/0601001, math.GT/0309136) ids,
// with an optional version
const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/

const toId = (aid: string) =>
  aid.startsWith(ABS_PREFIX) ? aid.slice(ABS_PREFIX.length) : null

// Pins and hides as bare ids, comma-joined (ids never hold a comma). An aid
// that isn't an arXiv abs URL can't be carried, so it's left out.
function encodeIds(aids: string[]): string {
  return aids
    .map(toId)
    .filter((id): id is string => !!id && ARXIV_ID.test(id))
    .join(',')
}

function decodeIds(value: string | null, max: number): string[] {
  if (!value) return []
  const ids = value.split(',').filter((id) => ARXIV_ID.test(id))
  return [...new Set(ids)].slice(0, max).map((id) => ABS_PREFIX + id)
}

// Values as the API cleans terms (api/recipe.py clean_terms): whitespace
// collapsed, blanks and case-insensitive duplicates dropped. Out-of-bounds
// values are dropped too, where the API would reject the whole request.
function cleanValues(
  values: string[],
  maxItems: number,
  maxLength: number,
  minLength = 1,
) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const t = v.replace(/\s+/g, ' ').trim()
    const len = termLength(t)
    if (len < minLength || len > maxLength || seen.has(t.toLowerCase()))
      continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === maxItems) break
  }
  return out
}

export function shareParams(graph: SharedGraph): URLSearchParams {
  const qs = new URLSearchParams()
  qs.set(K.version, VERSION)
  qs.set(K.name, graph.name)
  const f = graph.filters
  if (f) {
    for (const t of f.tags) qs.append(K.tags, t)
    for (const d of f.domains) qs.append(K.domains, d)
    // `w` doubles as the recipe marker, so a recipe with no other filter
    // ("all papers") still reads back as a recipe
    qs.set(K.date, f.datePreset)
    if (f.peerReviewed) qs.set(K.peerReviewed, '1')
    for (const k of f.keywords ?? []) qs.append(K.keywords, k)
    for (const a of f.authors ?? []) qs.append(K.authors, a)
  }
  const pinned = encodeIds(graph.pinned)
  if (pinned) qs.set(K.pinned, pinned)
  const hidden = encodeIds(graph.hidden)
  if (hidden) qs.set(K.hidden, hidden)
  return qs
}

// The link opens on `/`, which is the graph view on desktop and Browse on
// phones
export function buildShareUrl(
  graph: SharedGraph,
  origin: string = window.location.origin,
): string {
  return `${origin}/?${shareParams(graph)}`
}

const isPreset = (v: string | null): v is DatePreset =>
  DATE_PRESETS.some((p) => p.value === v)

// The graph a share link describes, or null when the params aren't one (or
// describe nothing to show). Anything out of bounds is clamped or dropped:
// a hand-edited link must never crash the app.
export function parseShareParams(qs: URLSearchParams): SharedGraph | null {
  if (qs.get(K.version) !== VERSION) return null

  const date = qs.get(K.date)
  const filters: GraphFilters | undefined =
    date === null
      ? undefined
      : {
          tags: cleanValues(qs.getAll(K.tags), MAX_FACETS, MAX_FACET_LENGTH),
          domains: cleanValues(
            qs.getAll(K.domains),
            MAX_FACETS,
            MAX_FACET_LENGTH,
          ),
          datePreset: isPreset(date) ? date : 'all',
          ...(qs.get(K.peerReviewed) === '1' ? { peerReviewed: true } : {}),
          ...optionalTerms('keywords', qs.getAll(K.keywords), MIN_TERM_LENGTH),
          ...optionalTerms('authors', qs.getAll(K.authors)),
        }

  const pinned = decodeIds(qs.get(K.pinned), MAX_PINNED)
  const hidden = decodeIds(qs.get(K.hidden), MAX_HIDDEN)
  if (!filters && pinned.length === 0) return null

  const name =
    (qs.get(K.name) ?? '').trim().slice(0, MAX_GRAPH_NAME_LENGTH) ||
    (filters
      ? defaultGraphName(filters, MAX_GRAPH_NAME_LENGTH)
      : 'Shared graph')
  return { name, ...(filters ? { filters } : {}), pinned, hidden }
}

// Absent rather than empty, as on recipes saved before these facets existed
function optionalTerms(
  key: 'keywords' | 'authors',
  values: string[],
  minLength = 1,
) {
  const terms = cleanValues(values, MAX_TERMS, MAX_TERM_LENGTH, minLength)
  return terms.length > 0 ? { [key]: terms } : {}
}

// The search string with the share params removed, keeping any others
export function withoutShareParams(search: string): string {
  const qs = new URLSearchParams(search)
  for (const k of SHARE_PARAM_KEYS) qs.delete(k)
  const rest = qs.toString()
  return rest ? `?${rest}` : ''
}
