import { useEffect, useState } from 'react'

/**
 * Fetches deployment capability flags from /health once on mount. Semantic
 * search defaults to false (hidden) until confirmed enabled, since it only
 * runs on self-hosted deployments that load the embedding model.
 */
export function useCapabilities(): { semanticSearch: boolean } {
  const [semanticSearch, setSemanticSearch] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { fetchHealth } = await import('../lib/api')
        const health = await fetchHealth()
        if (!alive) return
        setSemanticSearch(health.semantic_search)
      } catch {
        // Capability check is non-critical; leave semantic search hidden.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return { semanticSearch }
}
