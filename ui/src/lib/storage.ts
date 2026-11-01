import type { GraphFilters } from './graphFilters'

const KEY_PREFIX = 'ais_graph_'
const INDEX_KEY = 'ais_graphs'
const MAX_GRAPHS = 50
// Hand-added papers per graph. The filter recipe has no cap: the graph shows
// it a page (the backend's _MAX_RANGE) at a time.
export const MAX_PINNED = 500
// Must stay <= the backend's _MAX_EXCLUDE, which `hidden` is sent as.
export const MAX_HIDDEN = 500
export const MAX_GRAPH_NAME_LENGTH = 40

// A graph's papers are its recipe's matches plus `pinned`, minus `hidden`.
export type GraphMembership = {
  // Papers added by hand (search, related, Browse), shown on every page
  pinned: string[]
  // Recipe matches removed by hand
  hidden: string[]
}

export type SavedGraph = GraphMembership & {
  id: string
  name: string
  // Recipe the graph is generated from; absent on hand-built graphs and on
  // graphs saved before graphs were built from filters.
  filters?: GraphFilters
  createdAt: string
  updatedAt: string
}

// Graphs saved before pins existed hold a `paperIds` snapshot. Without a
// recipe those are all hand-picked, so they become pins. With one they were
// the recipe's first page (only ever saved on unreleased builds), which the
// recipe reproduces, so they're dropped.
type StoredGraph = Omit<SavedGraph, 'pinned' | 'hidden'> &
  Partial<GraphMembership> & { paperIds?: string[] }

function fromStored(stored: StoredGraph): SavedGraph {
  const { paperIds, ...rest } = stored
  return {
    ...rest,
    pinned: stored.pinned ?? (stored.filters ? [] : (paperIds ?? [])),
    hidden: stored.hidden ?? [],
  }
}

function checkLimits(m: Partial<GraphMembership>): void {
  if (m.pinned && m.pinned.length > MAX_PINNED)
    throw new Error(`Maximum ${MAX_PINNED} added papers per graph`)
  if (m.hidden && m.hidden.length > MAX_HIDDEN)
    throw new Error(`Maximum ${MAX_HIDDEN} removed papers per graph`)
}

function getIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function setIndex(ids: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids))
}

export function listSavedGraphs(): SavedGraph[] {
  return getIndex()
    .map(getSavedGraph)
    .filter(Boolean) as SavedGraph[]
}

export function getSavedGraph(id: string): SavedGraph | null {
  try {
    return fromStored(
      JSON.parse(localStorage.getItem(KEY_PREFIX + id) ?? '') as StoredGraph,
    )
  } catch {
    return null
  }
}

export function createSavedGraph(
  name: string,
  content: Partial<GraphMembership> & { filters?: GraphFilters } = {},
): SavedGraph {
  const index = getIndex()
  if (index.length >= MAX_GRAPHS)
    throw new Error(`Maximum ${MAX_GRAPHS} saved graphs reached`)
  checkLimits(content)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const graph: SavedGraph = {
    id,
    name,
    pinned: content.pinned ?? [],
    hidden: content.hidden ?? [],
    ...(content.filters ? { filters: content.filters } : {}),
    createdAt: now,
    updatedAt: now,
  }
  localStorage.setItem(KEY_PREFIX + id, JSON.stringify(graph))
  setIndex([...index, id])
  return graph
}

export function updateSavedGraph(
  id: string,
  updates: Partial<Pick<SavedGraph, 'name' | 'pinned' | 'hidden' | 'filters'>>,
): SavedGraph {
  const existing = getSavedGraph(id)
  if (!existing) throw new Error(`Graph ${id} not found`)
  checkLimits(updates)
  const updated: SavedGraph = { ...existing, ...updates, updatedAt: new Date().toISOString() }
  localStorage.setItem(KEY_PREFIX + id, JSON.stringify(updated))
  return updated
}

export function deleteSavedGraph(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id)
  setIndex(getIndex().filter((i) => i !== id))
}

// Adding a paper pins it (and un-hides it). Removing one unpins it, and hides
// it when the recipe would otherwise bring it back.
export function withAdded(m: GraphMembership, aid: string): GraphMembership {
  return {
    pinned: m.pinned.includes(aid) ? m.pinned : [...m.pinned, aid],
    hidden: m.hidden.filter((id) => id !== aid),
  }
}

export function withRemoved(
  m: GraphMembership,
  aid: string,
  matchedByRecipe: boolean,
): GraphMembership {
  return {
    pinned: m.pinned.filter((id) => id !== aid),
    hidden:
      matchedByRecipe && !m.hidden.includes(aid) ? [...m.hidden, aid] : m.hidden,
  }
}

const LEGEND_COLLAPSED_KEY = 'ais_legend_collapsed'

// Storage can be unavailable (private windows, blocked site data), so the
// legend falls back to expanded and simply forgets the choice.
export function getLegendCollapsed(): boolean {
  try {
    return localStorage.getItem(LEGEND_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function setLegendCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(LEGEND_COLLAPSED_KEY, '1')
    else localStorage.removeItem(LEGEND_COLLAPSED_KEY)
  } catch {
    // ignore
  }
}
