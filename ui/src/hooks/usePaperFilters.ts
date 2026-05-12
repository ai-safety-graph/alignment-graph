import { useMemo, useState } from 'react'
import type { GraphDataCompact, NodeCompact } from '../lib/types'

type ScoredItem = { n: NodeCompact; score: number; deg: number }

export function usePaperFilters(results: ScoredItem[], data: GraphDataCompact | null) {
  const [activeCids, setActiveCids] = useState<Set<number>>(new Set())
  const [activeYear, setActiveYear] = useState<number | null>(null)
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set())

  const clusterEntries = useMemo(
    () =>
      data
        ? (Object.entries(data.clusters) as Array<
            [string, { label?: string | null; size: number }]
          >)
        : [],
    [data],
  )

  const availableYears = useMemo(() => {
    if (!data) return []
    const years = new Set(data.nodes.map((n) => new Date(n.pd).getFullYear()))
    return [...years].sort((a, b) => a - b)
  }, [data])

  const availableDomains = useMemo(() => {
    if (!data) return []
    const domains = new Set(data.nodes.map((n) => n.dm).filter(Boolean))
    return [...domains].sort()
  }, [data])

  const filtered = useMemo(() => {
    let res =
      activeCids.size === 0
        ? results
        : results.filter(({ n }) => activeCids.has(n.cid))
    if (activeYear != null) {
      res = res.filter(({ n }) => new Date(n.pd).getFullYear() === activeYear)
    }
    if (activeDomains.size > 0) {
      res = res.filter(({ n }) => activeDomains.has(n.dm))
    }
    return res
  }, [results, activeCids, activeYear, activeDomains])

  const hasActiveFilters =
    activeCids.size > 0 || activeYear != null || activeDomains.size > 0

  function clearAllFilters() {
    setActiveCids(new Set())
    setActiveYear(null)
    setActiveDomains(new Set())
  }

  function toggleCluster(cid: number) {
    setActiveCids((prev) => {
      const next = new Set(prev)
      next.has(cid) ? next.delete(cid) : next.add(cid)
      return next
    })
  }

  function toggleYear(year: number) {
    setActiveYear((prev) => (prev === year ? null : year))
  }

  function toggleDomain(dm: string) {
    setActiveDomains((prev) => {
      const next = new Set(prev)
      next.has(dm) ? next.delete(dm) : next.add(dm)
      return next
    })
  }

  return {
    filtered,
    activeCids,
    activeYear,
    activeDomains,
    clusterEntries,
    availableYears,
    availableDomains,
    hasActiveFilters,
    clearAllFilters,
    toggleCluster,
    toggleYear,
    toggleDomain,
  }
}
