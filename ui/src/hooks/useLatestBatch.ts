import { useQuery } from '@tanstack/react-query'
import { fetchLatestBatch } from '../lib/api'
import type { LatestBatch } from '../lib/api'

/**
 * Fetches the latest pipeline batch ({date, added}) for the header badge.
 * Cached by the QueryClient so StatsView and GraphView share one request.
 */
export function useLatestBatch(): LatestBatch | null {
  const { data } = useQuery({
    queryKey: ['latest-batch'],
    queryFn: fetchLatestBatch,
  })

  return data ?? null
}
