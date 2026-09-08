import { useQuery } from '@tanstack/react-query'
import { fetchTags } from '../lib/api'
import type { TagsLegend } from '../lib/types'

// domain_tag is derived once per paper from its arXiv category codes
// (see domain_from_arxiv_categories in filters.py) and is a fixed, closed
// set -- not data that grows or changes as papers are harvested. Hardcoded
// here instead of fetched from /api/stats.
const DOMAINS = ['tech', 'gov', 'both']

/**
 * Fetches the tag legend. Shared by the list-based views (StatsView,
 * SubgraphView). Cached for the session by the QueryClient, so navigating
 * back to a view that already loaded the catalog renders instantly with
 * isLoading: false.
 */
export function useTagCatalog(): {
  tags: TagsLegend
  availableDomains: string[]
  isLoading: boolean
} {
  const { data: tags, isPending } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: fetchTags,
  })

  return {
    tags: tags ?? {},
    availableDomains: DOMAINS,
    isLoading: isPending,
  }
}
