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
import type { SharedGraph } from '../lib/shareLink'
import { track } from '../lib/analytics'
import { useDebouncedValue } from './useDebouncedValue'
import { useGraphContent } from './useGraphContent'
import { useSharedGraph } from './useSharedGraph'

// Stands in for a saved graph's id while a share link's graph is shown
export const SHARED_DRAFT_ID = 'shared'

// A share link's graph, shaped as a saved graph so the lists treat it as one.
// It isn't stored until the user saves it.
function asSavedGraph(shared: SharedGraph): SavedGraph {
  return {
    id: SHARED_DRAFT_ID,
    name: shared.name,
    ...(shared.filters ? { filters: shared.filters } : {}),
    pinned: shared.pinned,
    hidden: shared.hidden,
    createdAt: '',
    updatedAt: '',
  }
}

// What Browse lists for a selected graph: the papers its recipe matches, its
// pins, or all papers to pin from
export type GraphListMode = 'matches' | 'pinned' | 'all'

// A graph opens on its matches; one without a recipe has only pins
function defaultMode(graph: SavedGraph | undefined): GraphListMode {
  return graph && !graph.filters ? 'pinned' : 'matches'
}

// Browse's side of saved graphs. A graph is selected (shared with the graph
// view through the active-graph key) or not ("All papers"). A share link
// opens its graph as a read-only draft (SHARED_DRAFT_ID) to save or discard.
export function useSubgraphManager() {
  const { shared, clearShareParams } = useSharedGraph()
  const [sharedDraft, setSharedDraft] = useState<SavedGraph | null>(() =>
    shared ? asSavedGraph(shared) : null,
  )
  const [subgraphs, setSubgraphs] = useState<SavedGraph[]>(() =>
    listSavedGraphs().sort(byUpdatedDesc),
  )
  // The stored selection, which a shared draft only covers for now
  const activeSavedId = () => {
    const active = getActiveGraphId()
    return subgraphs.some((s) => s.id === active) ? active : null
  }
  const [selectedSubgraphId, setSelectedId] = useState<string | null>(() =>
    sharedDraft ? SHARED_DRAFT_ID : activeSavedId(),
  )
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [viewMode, setViewMode] = useState<GraphListMode>(() =>
    defaultMode(
      sharedDraft ?? subgraphs.find((s) => s.id === selectedSubgraphId),
    ),
  )
  useEffect(() => {
    if (shared)
      track('graph_open_shared', {
        pins: shared.pinned.length,
        has_recipe: !!shared.filters,
      })
    // Once per link opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leaving the shared draft (saved, discarded, edited, another graph
  // picked) drops it, and its link from the URL
  const dropSharedDraft = () => {
    setSharedDraft(null)
    clearShareParams()
  }
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
    // Picking the shared draft again changes nothing. Its id is a stand-in,
    // never stored as the active graph.
    if (id === SHARED_DRAFT_ID) return
    if (sharedDraft) dropSharedDraft()
    setSelectedId(id)
    setActiveGraphId(id)
    setViewMode(defaultMode(graph ?? subgraphs.find((s) => s.id === id)))
  }

  // Stores the shared draft under `name` and selects it. Returns an error
  // message when it can't be saved (e.g. the saved-graph cap).
  const saveSharedDraft = (name: string) => {
    if (!sharedDraft) return null
    let graph: SavedGraph
    try {
      graph = createSavedGraph(name, {
        ...(sharedDraft.filters ? { filters: sharedDraft.filters } : {}),
        pinned: sharedDraft.pinned,
        hidden: sharedDraft.hidden,
      })
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save graph'
    }
    dropSharedDraft()
    setSubgraphs((prev) => [graph, ...prev])
    // Same papers in the same list, so the list mode stays
    setSelectedId(graph.id)
    setActiveGraphId(graph.id)
    return null
  }

  // Back to the graph that was selected before the link opened
  const discardSharedDraft = () => {
    if (!sharedDraft) return
    track('graph_discard')
    const back = activeSavedId()
    dropSharedDraft()
    setSelectedId(back)
    setViewMode(defaultMode(subgraphs.find((s) => s.id === back)))
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

  const selectedSubgraph =
    selectedSubgraphId === SHARED_DRAFT_ID
      ? (sharedDraft ?? undefined)
      : subgraphs.find((subgraph) => subgraph.id === selectedSubgraphId)
  const isSharedDraft = !!sharedDraft && selectedSubgraph === sharedDraft

  // Changing the recipe keeps the papers pinned and hidden by hand. A shared
  // draft changes in memory, and stops matching its link.
  const editGraphFilters = (filters: GraphFilters) => {
    if (isSharedDraft) {
      setSharedDraft({ ...sharedDraft, filters })
      clearShareParams()
      return
    }
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

  // A shared draft's pins are read-only until it's saved
  const setMembership = (next: GraphMembership) => {
    if (!selectedSubgraphId || isSharedDraft) return
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
    if (!selectedSubgraphId || isSharedDraft) return
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
    isSharedDraft,
    saveSharedDraft,
    discardSharedDraft,
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
