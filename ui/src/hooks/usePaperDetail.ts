import { useEffect, useState } from 'react'
import type { PaperDetail } from '../lib/api'

/**
 * Loads the full paper detail (including summary) for the selected `aid`.
 * Returns `null` while loading or when nothing is selected. Mirrors the shape
 * of `useRelatedPapers` so StatsView reads declaratively.
 */
export function usePaperDetail(aid: string | null): PaperDetail | null {
  const [paper, setPaper] = useState<PaperDetail | null>(null)

  useEffect(() => {
    setPaper(null)
    if (!aid) return
    let alive = true
    import('../lib/api').then(({ fetchPaper }) => {
      fetchPaper(aid).then((p) => {
        if (alive) setPaper(p)
      })
    })
    return () => {
      alive = false
    }
  }, [aid])

  return paper
}
