import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '../lib/api'

/**
 * Fetches deployment capability flags from /health. Semantic search defaults
 * to false (hidden) until confirmed enabled, since it only runs on
 * self-hosted deployments that load the embedding model. Cached by the
 * QueryClient so StatsView and GraphView share one request instead of each
 * polling /health independently.
 */
export function useCapabilities(): { semanticSearch: boolean } {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  })

  return { semanticSearch: data?.semantic_search ?? false }
}
