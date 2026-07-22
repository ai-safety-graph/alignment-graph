import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchPapers } from '../lib/api'
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
  /** True while a filter/query change is refetching page 1 (stale results from
   * the previous combo are still shown via `keepPreviousData` in the meantime). */
  isFiltering: boolean
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Owns server-side filtered, paginated paper loading for the list views.
 * Reloads from page 1 whenever the query/date/cluster/domain filters change,
 * and appends subsequent pages via `loadMore` (driven by the list's infinite
 * scroll sentinel). Each filter combo is cached by the QueryClient, so
 * revisiting one (e.g. the default unfiltered view after navigating away and
 * back) renders instantly instead of refetching. Papers get a session-local
 * `id` by index — identity stays `aid` (see ARCHITECTURE "Numeric `id` is
 * assigned by index").
 */
export function usePaperBrowser({
  query,
  fromDate,
  activeCids,
  activeDomains,
  enabled = true,
}: Params): PaperBrowser {
  const cidsKey = [...activeCids].sort().join(',')
  const domainsKey = [...activeDomains].sort().join(',')

  const {
    data,
    hasNextPage,
    fetchNextPage,
    status,
    isFetching,
    isFetchingNextPage,
    error: queryError,
  } = useInfiniteQuery({
    queryKey: ['papers', query, fromDate ?? '', cidsKey, domainsKey],
    queryFn: ({ pageParam }) =>
      fetchPapers({
        q: query || undefined,
        from: fromDate,
        clusters: activeCids.size > 0 ? [...activeCids] : undefined,
        domains: activeDomains.size > 0 ? [...activeDomains] : undefined,
        limit: PAGE_SIZE,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0)
      return loaded < lastPage.total ? allPages.length + 1 : undefined
    },
    // Keep showing the previous filter combo's results while the new one
    // loads, instead of flashing back to the loading state on every change.
    placeholderData: keepPreviousData,
    enabled,
  })

  const papers = useMemo(() => {
    if (!data) return null
    let idx = 0
    return data.pages.flatMap((page) =>
      page.items.map((item): NodeCompact => ({ ...item, id: idx++ })),
    )
  }, [data])

  return {
    papers,
    total: data?.pages[0]?.total ?? 0,
    hasMore: hasNextPage ?? false,
    // Keep stale results on transient errors; only surface a hard failure
    // before anything has ever loaded.
    error:
      status === 'error' && !data
        ? `Failed to load papers: ${errMessage(queryError)}`
        : null,
    loadMore: () => {
      if (enabled) fetchNextPage()
    },
    isFiltering: isFetching && !isFetchingNextPage,
  }
}
