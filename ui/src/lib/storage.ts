const KEY_PREFIX = 'ais_graph_'
const INDEX_KEY = 'ais_graphs'
const MAX_GRAPHS = 50
const MAX_PAPERS = 500

export type SavedGraph = {
  id: string
  name: string
  paperIds: string[]
  createdAt: string
  updatedAt: string
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
    .map((id) => {
      try {
        return JSON.parse(localStorage.getItem(KEY_PREFIX + id) ?? '') as SavedGraph
      } catch {
        return null
      }
    })
    .filter(Boolean) as SavedGraph[]
}

export function getSavedGraph(id: string): SavedGraph | null {
  try {
    return JSON.parse(localStorage.getItem(KEY_PREFIX + id) ?? '') as SavedGraph
  } catch {
    return null
  }
}

export function createSavedGraph(name: string, paperIds: string[]): SavedGraph {
  const index = getIndex()
  if (index.length >= MAX_GRAPHS)
    throw new Error(`Maximum ${MAX_GRAPHS} saved graphs reached`)
  if (paperIds.length > MAX_PAPERS)
    throw new Error(`Maximum ${MAX_PAPERS} papers per graph`)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const graph: SavedGraph = { id, name, paperIds, createdAt: now, updatedAt: now }
  localStorage.setItem(KEY_PREFIX + id, JSON.stringify(graph))
  setIndex([...index, id])
  return graph
}

export function updateSavedGraph(
  id: string,
  updates: Partial<Pick<SavedGraph, 'name' | 'paperIds'>>,
): SavedGraph {
  const existing = getSavedGraph(id)
  if (!existing) throw new Error(`Graph ${id} not found`)
  if (updates.paperIds && updates.paperIds.length > MAX_PAPERS)
    throw new Error(`Maximum ${MAX_PAPERS} papers per graph`)
  const updated: SavedGraph = { ...existing, ...updates, updatedAt: new Date().toISOString() }
  localStorage.setItem(KEY_PREFIX + id, JSON.stringify(updated))
  return updated
}

export function deleteSavedGraph(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id)
  setIndex(getIndex().filter((i) => i !== id))
}
