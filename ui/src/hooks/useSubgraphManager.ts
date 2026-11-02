import { useEffect, useMemo, useState } from 'react'
import {
  byUpdatedDesc,
  createSavedGraph,
  deleteSavedGraph,
  getActiveGraphId,
  listSavedGraphs,
  MAX_PINNED,
  setActiveGraphId,
  updateSavedGraph,
  withAdded,
  withRemoved,
  type GraphMembership,
  type SavedGraph,
} from '../lib/storage'
import type { GraphFilters } from '../lib/graphFilters'
import { useDebouncedValue } from './useDebouncedValue'
import { useGraphContent } from './useGraphContent'

// What Browse lists for a selected graph: the papers its recipe matches, its
// pins, or all papers to pin from
export type GraphListMode = 'matches' | 'pinned' | 'all'

// A graph opens on its matches; one without a recipe has only pins
function defaultMode(graph: SavedGraph | undefined): GraphListMode {
  return graph && !graph.filters ? 'pinned' : 'matches'
}

// Browse's side of saved graphs. A graph is selected (shared with the graph
// view through the active-graph key) or not ("All papers").
export function useSubgraphManager() {
  const [subgraphs, setSubgraphs] = useState<SavedGraph[]>(() =>
    listSavedGraphs().sort(byUpdatedDesc),
  )
  const [selectedSubgraphId, setSelectedId] = useState<string | null>(() => {
    const active = getActiveGraphId()
    return subgraphs.some((s) => s.id === active) ? active : null
  })
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [viewMode, setViewMode] = useState<GraphListMode>(() =>
    defaultMode(subgraphs.find((s) => s.id === selectedSubgraphId)),
  )
  const [subgraphQuery, setSubgraphQuery] = useState('')
  const debouncedSubgraphQuery = useDebouncedValue(subgraphQuery, 300)
  const [subgraphActiveTags, setSubgraphActiveTags] = useState<Set<string>>(
    new Set(),
  )
  const [subgraphActiveDomains, setSubgraphActiveDomains] = useState<
    Set<string>
  >(new Set())

  // Selecting a graph (or "All papers", null) also makes it the graph view's
  const setSelectedSubgraphId = (id: string | null, graph?: SavedGraph) => {
    setSelectedId(id)
    setActiveGraphId(id)
    setViewMode(defaultMode(graph ?? subgraphs.find((s) => s.id === id)))
  }

  // Saves a graph generated from filters and selects it. Returns an error
  // message when it can't be saved (e.g. the saved-graph cap).
  const createGraph = (filters: GraphFilters, name: string) => {
    let graph: SavedGraph
    try {
      graph = createSavedGraph(name, { filters })
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save graph'
    }
    setSubgraphs((prev) => [graph, ...prev])
    setSelectedSubgraphId(graph.id, graph)
    return null
  }

  const selectedSubgraph = subgraphs.find(
    (subgraph) => subgraph.id === selectedSubgraphId,
  )

  // Changing the recipe keeps the papers pinned and hidden by hand
  const editGraphFilters = (filters: GraphFilters) => {
    if (!selectedSubgraphId) return
    const updated = updateSavedGraph(selectedSubgraphId, { filters })
    setSubgraphs((prev) => [
      updated,
      ...prev.filter((s) => s.id !== updated.id),
    ])
  }

  // Only the graph's pins: Browse lists papers added by hand, while the
  // recipe's matches live on the graph view. Same query key as the graph
  // view's pins, so each view reuses what the other loaded.
  const pinned = selectedSubgraph?.pinned
  const content = useGraphContent(
    selectedSubgraph
      ? {
          graphKey: selectedSubgraph.id,
          filters: null,
          pinned: selectedSubgraph.pinned,
          hidden: [],
          cursor: null,
        }
      : null,
  )
  const selectedSubgraphPaperIds = useMemo(
    () => new Set(pinned ?? []),
    [pinned],
  )
  const pinnedFull = (pinned?.length ?? 0) >= MAX_PINNED

  // The previous pins stay on screen while the new set loads, so drop an
  // unpinned paper locally to show the removal straight away
  const subgraphNodes = useMemo(
    () =>
      content.isEmpty
        ? []
        : (content.data?.nodes.filter((n) =>
            selectedSubgraphPaperIds.has(n.aid),
          ) ?? null),
    [content.isEmpty, content.data, selectedSubgraphPaperIds],
  )
  const subgraphError = content.error
    ? `Failed to load graph: ${content.error.message}`
    : null

  const setMembership = (next: GraphMembership) => {
    if (!selectedSubgraphId) return
    let updated: SavedGraph
    try {
      updated = updateSavedGraph(selectedSubgraphId, next)
    } catch {
      return
    }
    setSubgraphs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
  }

  const addToSelectedSubgraph = (aid: string) => {
    if (selectedSubgraph) setMembership(withAdded(selectedSubgraph, aid))
  }

  // Unpins only: a paper the recipe matches stays in the graph, as the user
  // removed the pin rather than the paper
  const removeFromSelectedSubgraph = (aid: string) => {
    if (selectedSubgraph)
      setMembership(withRemoved(selectedSubgraph, aid))
  }

  const confirmDeleteSubgraph = () => {
    if (!selectedSubgraphId) return
    deleteSavedGraph(selectedSubgraphId)
    const remaining = subgraphs.filter((s) => s.id !== selectedSubgraphId)
    setSubgraphs(remaining)
    setSelectedSubgraphId(remaining[0]?.id ?? null)
    setIsConfirmingDelete(false)
  }

  useEffect(() => {
    setSubgraphQuery('')
    setSubgraphActiveTags(new Set())
    setSubgraphActiveDomains(new Set())
  }, [selectedSubgraphId])

  // Counts every tag a node holds (any rank, not just primary), matching
  // /api/tags' `size` semantics -- a paper with 3 tags contributes to 3 counts.
  const subgraphTagEntries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of subgraphNodes ?? []) {
      for (const tag of n.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()].map(
      ([tag, size]) => [tag, { size }] as [string, { size: number }],
    )
  }, [subgraphNodes])

  const subgraphAvailableDomains = useMemo(
    () => [...new Set((subgraphNodes ?? []).map((n) => n.dm))].sort(),
    [subgraphNodes],
  )

  const hasActiveSubgraphFilters =
    subgraphActiveTags.size > 0 || subgraphActiveDomains.size > 0

  const toggleSubgraphTag = (tag: string) => {
    setSubgraphActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const toggleSubgraphDomain = (dm: string) => {
    setSubgraphActiveDomains((prev) => {
      const next = new Set(prev)
      if (next.has(dm)) next.delete(dm)
      else next.add(dm)
      return next
    })
  }

  const clearSubgraphFilters = () => {
    setSubgraphQuery('')
    setSubgraphActiveTags(new Set())
    setSubgraphActiveDomains(new Set())
  }

  const filteredSubgraphNodes = useMemo(() => {
    const q = debouncedSubgraphQuery.trim().toLowerCase()
    return (subgraphNodes ?? []).filter((n) => {
      if (
        q &&
        !n.t.toLowerCase().includes(q) &&
        !n.au.toLowerCase().includes(q)
      )
        return false
      if (
        subgraphActiveTags.size > 0 &&
        !n.tags.some((t) => subgraphActiveTags.has(t))
      )
        return false
      if (subgraphActiveDomains.size > 0 && !subgraphActiveDomains.has(n.dm))
        return false
      return true
    })
  }, [
    subgraphNodes,
    debouncedSubgraphQuery,
    subgraphActiveTags,
    subgraphActiveDomains,
  ])

  const subgraphItems = useMemo(
    () => filteredSubgraphNodes.map((n) => ({ n })),
    [filteredSubgraphNodes],
  )

  const subgraphNodeIds = useMemo(
    () => new Set((subgraphNodes ?? []).map((n) => n.aid)),
    [subgraphNodes],
  )

  return {
    subgraphs,
    selectedSubgraphId,
    setSelectedSubgraphId,
    selectedSubgraph,
    selectedSubgraphPaperIds,
    pinnedFull,
    createGraph,
    editGraphFilters,
    isConfirmingDelete,
    setIsConfirmingDelete,
    confirmDeleteSubgraph,
    viewMode,
    setViewMode,
    subgraphNodes,
    subgraphError,
    addToSelectedSubgraph,
    removeFromSelectedSubgraph,
    subgraphQuery,
    setSubgraphQuery,
    debouncedSubgraphQuery,
    subgraphActiveTags,
    subgraphActiveDomains,
    toggleSubgraphTag,
    toggleSubgraphDomain,
    clearSubgraphFilters,
    hasActiveSubgraphFilters,
    subgraphTagEntries,
    subgraphAvailableDomains,
    filteredSubgraphNodes,
    subgraphItems,
    subgraphNodeIds,
  }
}
