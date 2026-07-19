import { useQuery } from '@tanstack/react-query'
import { fetchClusters, fetchStats } from '../lib/api'
import type { ClustersLegend } from '../lib/types'

/**
 * Fetches the cluster legend and the sorted list of available domains.
 * Shared by the list-based views (StatsView, MobileView). Cached for the
 * session by the QueryClient, so navigating back to a view that already
 * loaded the catalog renders instantly with isLoading: false.
 */
export function useClusterCatalog(): {
  clusters: ClustersLegend
  availableDomains: string[]
  isLoading: boolean
} {
  const { data, isPending } = useQuery({
    queryKey: ['cluster-catalog'],
    queryFn: () => Promise.all([fetchClusters(), fetchStats()]),
  })

  const [clusters, stats] = data ?? [{}, undefined]

  return {
    clusters: clusters ?? {},
    availableDomains: stats
      ? Object.keys(stats.domains).filter(Boolean).sort()
      : [],
    isLoading: isPending,
  }
}
