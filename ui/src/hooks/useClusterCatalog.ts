import { useEffect, useState } from 'react'
import type { ClustersLegend } from '../lib/types'

/**
 * Fetches the cluster legend and the sorted list of available domains once on
 * mount. Shared by the list-based views (StatsView, MobileView).
 */
export function useClusterCatalog(): {
  clusters: ClustersLegend
  availableDomains: string[]
  isLoading: boolean
} {
  const [clusters, setClusters] = useState<ClustersLegend>({})
  const [availableDomains, setAvailableDomains] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { fetchClusters, fetchStats } = await import('../lib/api')
        const [allClusters, stats] = await Promise.all([
          fetchClusters(),
          fetchStats(),
        ])
        if (!alive) return
        setClusters(allClusters)
        setAvailableDomains(Object.keys(stats.domains).filter(Boolean).sort())
      } catch {
        // Catalog is non-critical chrome; leave defaults if it fails.
      } finally {
        if (alive) setIsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return { clusters, availableDomains, isLoading }
}
