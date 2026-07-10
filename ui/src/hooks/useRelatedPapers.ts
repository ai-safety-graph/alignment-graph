import { useState, useEffect } from 'react'
import type { NodeCompact } from '../lib/types'

type NeighborEntry = { n: NodeCompact; w: number }

export function useRelatedPapers(aid: string | null): { neighbors: NeighborEntry[]; loading: boolean } {
  const [neighbors, setNeighbors] = useState<NeighborEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setNeighbors([])
    if (!aid) {
      setLoading(false)
      return
    }
    setLoading(true)
    let alive = true
    ;(async () => {
      try {
        const { fetchRelated } = await import('../lib/api')
        const results = await fetchRelated(aid)
        if (!alive) return
        setNeighbors(results.map((r, i): NeighborEntry => ({ n: { ...r, id: i }, w: r.sim })))
      } catch {
        if (alive) setNeighbors([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [aid])

  return { neighbors, loading }
}
