import { useQuery } from '@tanstack/react-query'
import { fetchPaper, type PaperDetail } from '../lib/api'

/**
 * Loads the full paper detail (including summary) for the selected `aid`.
 * Returns `null` while loading or when nothing is selected. Mirrors the shape
 * of `useRelatedPapers` so StatsView reads declaratively. Cached per `aid` by
 * the QueryClient so re-selecting a paper doesn't refetch it.
 */
export function usePaperDetail(aid: string | null): PaperDetail | null {
  const { data } = useQuery({
    queryKey: ['paper', aid],
    queryFn: () => fetchPaper(aid!),
    enabled: aid != null,
  })

  return data ?? null
}
