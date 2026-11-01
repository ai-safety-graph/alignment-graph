import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { toRangeParams } from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'
import { mergeGraphContent } from '../lib/graphContent'
import type { GraphCursor, GraphDataCompact } from '../lib/types'

export type GraphContentSpec = {
  // Identifies the graph ('draft' or a saved graph's id), so a reload of the
  // same graph keeps showing its old data while a switch to another doesn't
  graphKey: string
  filters: GraphFilters | null
  pinned: string[]
  hidden: string[]
  cursor: GraphCursor | null
}

// Keeps the previous result on screen while a query reloads for the same
// graph (a new page, a pin, a hide), instead of flashing the loading state.
// `index` is the key element that identifies the graph.
function keepWhileSame(
  index: number,
  prev: GraphDataCompact | undefined,
  prevQuery: { queryKey: readonly unknown[] } | undefined,
  key: readonly unknown[],
) {
  return prevQuery &&
    JSON.stringify(prevQuery.queryKey[index]) === JSON.stringify(key[index])
    ? keepPreviousData(prev)
    : undefined
}

// A graph's nodes (see mergeGraphContent): its recipe's current page via
// /api/graph/range and its pins via /api/graph/subset, as two queries so a
// pin only refetches the pins and a hide or page change only the page.
export function useGraphContent(spec: GraphContentSpec | null) {
  const filters = spec?.filters ?? null
  const hidden = spec?.hidden ?? []
  const pinned = spec?.pinned ?? []

  const rangeKey = ['graphRange', filters, hidden, spec?.cursor ?? null] as const
  const page = useQuery({
    queryKey: rangeKey,
    queryFn: async () => {
      const { fetchGraphRange } = await import('../lib/api')
      return fetchGraphRange({
        ...toRangeParams(filters!),
        exclude: hidden,
        before: spec?.cursor ?? null,
      })
    },
    enabled: !!filters,
    placeholderData: (prev, prevQuery) =>
      keepWhileSame(1, prev, prevQuery, rangeKey),
  })

  const pinsKey = graphPinsKey(spec?.graphKey ?? '', pinned)
  const pins = useQuery({
    queryKey: pinsKey,
    queryFn: async () => {
      const { fetchSubgraph } = await import('../lib/api')
      return fetchSubgraph(pinned)
    },
    // The backend rejects an empty ids list
    enabled: pinned.length > 0,
    placeholderData: (prev, prevQuery) =>
      keepWhileSame(1, prev, prevQuery, pinsKey),
  })

  const pageData = filters ? page.data : undefined
  const pinsData = pinned.length > 0 ? pins.data : undefined
  const data = useMemo(
    () => mergeGraphContent(pageData, pinsData, new Set(hidden)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageData, pinsData, JSON.stringify(hidden)],
  )

  const isEmpty = !!spec && !filters && pinned.length === 0
  return {
    data,
    // Ids of the papers the recipe matched on this page, so removing one
    // knows to hide it rather than only unpin it
    pageAids: useMemo(
      () => new Set(pageData?.nodes.map((n) => n.aid)),
      [pageData],
    ),
    isLoading:
      (!!filters && page.isLoading) || (pinned.length > 0 && pins.isLoading),
    error: (filters ? page.error : null) ?? (pinned.length ? pins.error : null),
    isEmpty,
  }
}

// Query keys the hook reads, so a caller can seed them (e.g. saving a draft
// as a saved graph shouldn't refetch its pins)
export function graphPinsKey(graphKey: string, pinned: string[]) {
  return ['graphPins', graphKey, pinned] as const
}
