import { useEffect, useMemo, useState } from 'react'
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
  MAX_GRAPH_NAME_LENGTH,
  updateSavedGraph,
  withAdded,
  withRemoved,
  type GraphMembership,
  type SavedGraph,
} from '../lib/storage'
import { useDebouncedValue } from './useDebouncedValue'
import { useGraphContent } from './useGraphContent'

export function useSubgraphManager() {
  const [subgraphs, setSubgraphs] = useState<SavedGraph[]>(() =>
    listSavedGraphs(),
  )
  const [selectedSubgraphId, setSelectedSubgraphId] = useState<string | null>(
    () =>
      subgraphs.reduce(
        (latest, s) => (!latest || s.createdAt > latest.createdAt ? s : latest),
        null as SavedGraph | null,
      )?.id ?? null,
  )
  const [isCreatingSubgraph, setIsCreatingSubgraph] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [newSubgraphName, setNewSubgraphName] = useState('')
  const [viewMode, setViewMode] = useState<'browse' | 'subgraph'>('browse')
  const [subgraphQuery, setSubgraphQuery] = useState('')
  const debouncedSubgraphQuery = useDebouncedValue(subgraphQuery, 300)
  const [subgraphActiveTags, setSubgraphActiveTags] = useState<Set<string>>(
    new Set(),
  )
  const [subgraphActiveDomains, setSubgraphActiveDomains] = useState<
    Set<string>
  >(new Set())

  const createSubgraph = (name: string) => {
    const subgraph = createSavedGraph(name)
    setSubgraphs((prev) => [...prev, subgraph])
    setSelectedSubgraphId(subgraph.id)
  }

  const startCreatingSubgraph = () => {
    setNewSubgraphName('')
    setIsCreatingSubgraph(true)
  }

  const cancelCreatingSubgraph = () => {
    setIsCreatingSubgraph(false)
    setNewSubgraphName('')
  }

  const confirmCreateSubgraph = () => {
    const name = newSubgraphName.trim().slice(0, MAX_GRAPH_NAME_LENGTH)
    if (!name) return
    createSubgraph(name)
    setIsCreatingSubgraph(false)
    setNewSubgraphName('')
  }

  const selectedSubgraph = subgraphs.find(
    (subgraph) => subgraph.id === selectedSubgraphId,
  )

  // The first page of the graph's recipe plus its pins, as on the graph view
  // (same query keys, so each view reuses what the other loaded). Loaded in
  // browse mode too, so the list can mark papers already in the graph.
  const content = useGraphContent(
    selectedSubgraph
      ? {
          graphKey: selectedSubgraph.id,
          filters: selectedSubgraph.filters ?? null,
          pinned: selectedSubgraph.pinned,
          hidden: selectedSubgraph.hidden,
          cursor: null,
        }
      : null,
  )
  const subgraphNodes = useMemo(
    () => (content.isEmpty ? [] : (content.data?.nodes ?? null)),
    [content.isEmpty, content.data],
  )
  const subgraphError = content.error
    ? `Failed to load graph: ${content.error.message}`
    : null

  const selectedSubgraphPaperIds = useMemo(
    () =>
      new Set([
        ...(selectedSubgraph?.pinned ?? []),
        ...(content.data?.nodes.map((n) => n.aid) ?? []),
      ]),
    [selectedSubgraph, content.data],
  )

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

  const removeFromSelectedSubgraph = (aid: string) => {
    if (selectedSubgraph)
      setMembership(
        withRemoved(selectedSubgraph, aid, content.pageAids.has(aid)),
      )
  }

  const toggleViewMode = () => {
    if (!selectedSubgraphId) return
    setViewMode((m) => (m === 'subgraph' ? 'browse' : 'subgraph'))
  }

  const confirmDeleteSubgraph = () => {
    if (!selectedSubgraphId) return
    deleteSavedGraph(selectedSubgraphId)
    const remaining = subgraphs.filter((s) => s.id !== selectedSubgraphId)
    setSubgraphs(remaining)
    setSelectedSubgraphId(
      remaining.reduce(
        (latest, s) => (!latest || s.createdAt > latest.createdAt ? s : latest),
        null as SavedGraph | null,
      )?.id ?? null,
    )
    setViewMode('browse')
    setIsConfirmingDelete(false)
  }

  // Removal shows straight away: the hidden paper is filtered out locally
  const removeFromSubgraphView = removeFromSelectedSubgraph

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
    isCreatingSubgraph,
    newSubgraphName,
    setNewSubgraphName,
    startCreatingSubgraph,
    cancelCreatingSubgraph,
    confirmCreateSubgraph,
    isConfirmingDelete,
    setIsConfirmingDelete,
    confirmDeleteSubgraph,
    viewMode,
    toggleViewMode,
    subgraphNodes,
    subgraphError,
    addToSelectedSubgraph,
    removeFromSelectedSubgraph,
    removeFromSubgraphView,
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
