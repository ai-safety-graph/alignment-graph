import { useState, useEffect } from 'react'
import type { NodeCompact } from '../lib/types'

type NeighborEntry = { n: NodeCompact; w: number }

export function useRelatedPapers(
  paper: NodeCompact | null,
  aidToId: Map<string, number>,
): NeighborEntry[] {
  const [neighbors, setNeighbors] = useState<NeighborEntry[]>([])

  useEffect(() => {
    if (!paper) {
      setNeighbors([])
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { fetchRelated } = await import('../lib/api')
        const results = await fetchRelated(paper.aid)
        if (!alive) return
        setNeighbors(
          results.flatMap((r): NeighborEntry[] => {
            const id = aidToId.get(r.aid)
            if (id == null) return []
            return [{ n: { ...r, id }, w: r.sim }]
          }),
        )
      } catch {
        if (alive) setNeighbors([])
      }
    })()
    return () => {
      alive = false
    }
  }, [paper?.aid, aidToId])

  return neighbors
}
