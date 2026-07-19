import { useQuery } from '@tanstack/react-query'
import { fetchRelated } from '../lib/api'
import type { NodeCompact } from '../lib/types'

type NeighborEntry = { n: NodeCompact; w: number }

/** Cached per `aid` by the QueryClient so re-selecting a paper doesn't refetch its neighbors. */
export function useRelatedPapers(aid: string | null): { neighbors: NeighborEntry[]; loading: boolean } {
  const { data, isPending } = useQuery({
    queryKey: ['related', aid],
    queryFn: () => fetchRelated(aid!),
    enabled: aid != null,
  })

  const neighbors = data
    ? data.map((r, i): NeighborEntry => ({ n: { ...r, id: i }, w: r.sim }))
    : []

  return { neighbors, loading: aid != null && isPending }
}
