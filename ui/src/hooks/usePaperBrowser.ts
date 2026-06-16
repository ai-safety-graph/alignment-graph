import { useEffect, useRef, useState } from 'react'
import type { NodeCompact } from '../lib/types'

const PAGE_SIZE = 50

type Params = {
  /** Debounced keyword query. */
  query: string
  fromDate: string | undefined
  activeCids: Set<number>
  activeDomains: Set<string>
  /** When false, the browser pauses fetching (e.g. MobileView semantic mode). */
  enabled?: boolean
}

type PaperBrowser = {
  papers: NodeCompact[] | null
  total: number
  hasMore: boolean
  error: string | null
  loadMore: () => void
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Owns server-side filtered, paginated paper loading for the list views.
 * Reloads from page 1 whenever the query/date/cluster/domain filters change,
 * and appends subsequent pages via `loadMore` (driven by the list's infinite
 * scroll sentinel). Papers get a session-local `id` by index — identity stays
 * `aid` (see ARCHITECTURE "Numeric `id` is assigned by index").
 */
export function usePaperBrowser({
  query,
  fromDate,
  activeCids,
  activeDomains,
  enabled = true,
}: Params): PaperBrowser {
  const [papers, setPapers] = useState<NodeCompact[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasLoadedRef = useRef(false)
  const isLoadingMoreRef = useRef(false)
  // Mirrors the live params so loadMore (called from a stable sentinel
  // callback) always reads fresh values without re-subscribing.
  const loadParamsRef = useRef({ query, fromDate, page: 1, hasMore, activeCids, activeDomains })
  loadParamsRef.current = { query, fromDate, page: loadParamsRef.current.page, hasMore, activeCids, activeDomains }

  // Reload from page 1 whenever the filters change.
  useEffect(() => {
    if (!enabled) return
    let alive = true
    isLoadingMoreRef.current = false
    ;(async () => {
      try {
        const { fetchPapers } = await import('../lib/api')
        const result = await fetchPapers({
          q: query || undefined,
          from: fromDate,
          clusters: activeCids.size > 0 ? [...activeCids] : undefined,
          domains: activeDomains.size > 0 ? [...activeDomains] : undefined,
          limit: PAGE_SIZE,
        })
        if (!alive) return
        setPapers(result.items.map((item, i) => ({ ...item, id: i })))
        loadParamsRef.current.page = 1
        setTotal(result.total)
        setHasMore(result.items.length < result.total)
        setError(null)
        hasLoadedRef.current = true
      } catch (e: unknown) {
        if (!alive) return
        // Keep stale results on transient errors; only surface a hard failure
        // before anything has ever loaded.
        if (!hasLoadedRef.current) setError(`Failed to load papers: ${errMessage(e)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [query, fromDate, activeCids, activeDomains, enabled])

  async function loadMore() {
    const { query: q, fromDate: fd, page: p, hasMore: hm, activeCids: cids, activeDomains: dms } = loadParamsRef.current
    if (!enabled || !hm || isLoadingMoreRef.current) return
    isLoadingMoreRef.current = true
    try {
      const { fetchPapers } = await import('../lib/api')
      const result = await fetchPapers({
        q: q || undefined,
        from: fd,
        clusters: cids.size > 0 ? [...cids] : undefined,
        domains: dms.size > 0 ? [...dms] : undefined,
        limit: PAGE_SIZE,
        page: p + 1,
      })
      setPapers((prev) => {
        const prevLen = prev?.length ?? 0
        const next = [...(prev ?? []), ...result.items.map((item, i) => ({ ...item, id: prevLen + i }))]
        setHasMore(next.length < result.total)
        return next
      })
      loadParamsRef.current.page = p + 1
      setTotal(result.total)
    } catch (e: unknown) {
      // Non-fatal: the sentinel can retry on the next intersection.
      console.error('loadMore failed:', errMessage(e))
    } finally {
      isLoadingMoreRef.current = false
    }
  }

  return { papers, total, hasMore, error, loadMore }
}
