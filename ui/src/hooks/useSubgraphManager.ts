import { useEffect, useMemo, useState } from 'react'
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
  updateSavedGraph,
  type SavedGraph,
} from '../lib/storage'
import type { ClustersLegend, NodeCompact } from '../lib/types'
import { useDebouncedValue } from './useDebouncedValue'

export function useSubgraphManager(clusters: ClustersLegend) {
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
  const [subgraphNodes, setSubgraphNodes] = useState<NodeCompact[] | null>(
    null,
  )
  const [subgraphError, setSubgraphError] = useState<string | null>(null)
  const [subgraphQuery, setSubgraphQuery] = useState('')
  const debouncedSubgraphQuery = useDebouncedValue(subgraphQuery, 300)
  const [subgraphActiveCids, setSubgraphActiveCids] = useState<Set<number>>(
    new Set(),
  )
  const [subgraphActiveDomains, setSubgraphActiveDomains] = useState<
    Set<string>
  >(new Set())

  const createSubgraph = (name: string) => {
    const subgraph = createSavedGraph(name, [])
    setSubgraphs((prev) => [...prev, subgraph])
    setSelectedSubgraphId(subgraph.id)
  }

  const addToSelectedSubgraph = (aid: string) => {
    if (!selectedSubgraphId) return
    const current = subgraphs.find((s) => s.id === selectedSubgraphId)
    if (!current || current.paperIds.includes(aid)) return
    const updated = updateSavedGraph(selectedSubgraphId, {
      paperIds: [...current.paperIds, aid],
    })
    setSubgraphs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
  }

  const removeFromSelectedSubgraph = (aid: string) => {
    if (!selectedSubgraphId) return
    const current = subgraphs.find((s) => s.id === selectedSubgraphId)
    if (!current) return
    const updated = updateSavedGraph(selectedSubgraphId, {
      paperIds: current.paperIds.filter((id) => id !== aid),
    })
    setSubgraphs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
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
    const name = newSubgraphName.trim()
    if (!name) return
    createSubgraph(name)
    setIsCreatingSubgraph(false)
    setNewSubgraphName('')
  }

  const selectedSubgraph = subgraphs.find(
    (subgraph) => subgraph.id === selectedSubgraphId,
  )

  const selectedSubgraphPaperIds = useMemo(
    () => new Set(selectedSubgraph?.paperIds ?? []),
    [selectedSubgraph],
  )

  useEffect(() => {
    if (viewMode !== 'subgraph' || !selectedSubgraphId) return
    const paperIds = selectedSubgraph?.paperIds ?? []
    if (paperIds.length === 0) {
      setSubgraphNodes([])
      return
    }
    let alive = true
    setSubgraphNodes(null)
    setSubgraphError(null)
    ;(async () => {
      try {
        const { fetchSubgraph } = await import('../lib/api')
        const data = await fetchSubgraph(paperIds)
        if (alive) setSubgraphNodes(data.nodes)
      } catch (e: unknown) {
        if (alive)
          setSubgraphError(
            e instanceof Error ? e.message : 'Failed to load graph',
          )
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedSubgraphId])

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
    setSubgraphNodes(null)
    setViewMode('browse')
    setIsConfirmingDelete(false)
  }

  const removeFromSubgraphView = (aid: string) => {
    removeFromSelectedSubgraph(aid)
    setSubgraphNodes((prev) => (prev ?? []).filter((n) => n.aid !== aid))
  }

  useEffect(() => {
    setSubgraphQuery('')
    setSubgraphActiveCids(new Set())
    setSubgraphActiveDomains(new Set())
    setSubgraphError(null)
  }, [selectedSubgraphId])

  const subgraphClusterEntries = useMemo(() => {
    const counts = new Map<number, number>()
    for (const n of subgraphNodes ?? []) {
      counts.set(n.cid, (counts.get(n.cid) ?? 0) + 1)
    }
    return [...counts.entries()].map(
      ([cid, size]) =>
        [String(cid), { label: clusters[cid]?.label, size }] as [
          string,
          { label?: string | null; size: number },
        ],
    )
  }, [subgraphNodes, clusters])

  const subgraphAvailableDomains = useMemo(
    () => [...new Set((subgraphNodes ?? []).map((n) => n.dm))].sort(),
    [subgraphNodes],
  )

  const hasActiveSubgraphFilters =
    subgraphActiveCids.size > 0 || subgraphActiveDomains.size > 0

  const toggleSubgraphCluster = (cid: number) => {
    setSubgraphActiveCids((prev) => {
      const next = new Set(prev)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
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
    setSubgraphActiveCids(new Set())
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
      if (subgraphActiveCids.size > 0 && !subgraphActiveCids.has(n.cid))
        return false
      if (subgraphActiveDomains.size > 0 && !subgraphActiveDomains.has(n.dm))
        return false
      return true
    })
  }, [
    subgraphNodes,
    debouncedSubgraphQuery,
    subgraphActiveCids,
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
    subgraphActiveCids,
    subgraphActiveDomains,
    toggleSubgraphCluster,
    toggleSubgraphDomain,
    clearSubgraphFilters,
    hasActiveSubgraphFilters,
    subgraphClusterEntries,
    subgraphAvailableDomains,
    filteredSubgraphNodes,
    subgraphItems,
    subgraphNodeIds,
  }
}
