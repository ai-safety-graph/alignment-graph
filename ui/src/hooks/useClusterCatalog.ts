import { useQuery } from '@tanstack/react-query'
import { fetchClusters } from '../lib/api'
import type { ClustersLegend } from '../lib/types'

// domain_tag is derived once per paper from its arXiv category codes
// (see domain_from_arxiv_categories in filters.py) and is a fixed, closed
// set -- not data that grows or changes as papers are harvested. Hardcoded
// here instead of fetched from /api/stats.
const DOMAINS = ['tech', 'gov', 'both']

/**
 * Fetches the cluster legend. Shared by the list-based views (StatsView,
 * MobileView). Cached for the session by the QueryClient, so navigating
 * back to a view that already loaded the catalog renders instantly with
 * isLoading: false.
 */
export function useClusterCatalog(): {
  clusters: ClustersLegend
  availableDomains: string[]
  isLoading: boolean
} {
  const { data: clusters, isPending } = useQuery({
    queryKey: ['cluster-catalog'],
    queryFn: fetchClusters,
  })

  return {
    clusters: clusters ?? {},
    availableDomains: DOMAINS,
    isLoading: isPending,
  }
}
