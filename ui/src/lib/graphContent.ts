import type { GraphDataCompact, TagsLegend } from './types'

// A graph's nodes: one page of its recipe's matches, then its pinned papers
// that aren't on that page, minus hidden ones. Both responses are normalised
// against the same corpus bounds, so their coords can be mixed as they are.
// Page nodes come first, so pinning a paper doesn't renumber them.
export function mergeGraphContent(
  page: GraphDataCompact | undefined,
  pins: GraphDataCompact | undefined,
  hidden: ReadonlySet<string>,
): GraphDataCompact | undefined {
  const base = page ?? pins
  if (!base) return undefined
  const onPage = new Set(page?.nodes.map((n) => n.aid))
  const nodes = [
    ...(page?.nodes ?? []),
    ...(pins?.nodes ?? []).filter((n) => !onPage.has(n.aid)),
  ]
    // Hidden papers are excluded server-side too; filtering here drops a
    // removed paper before the refetch lands.
    .filter((n) => !hidden.has(n.aid))
    .map((n, i) => ({ ...n, id: i }))

  const tags: TagsLegend = {}
  for (const n of nodes)
    for (const t of n.tags) tags[t] = { size: (tags[t]?.size ?? 0) + 1 }

  const included =
    (page?.meta.coords.included ?? true) && (pins?.meta.coords.included ?? true)
  return {
    ...base,
    meta: {
      ...base.meta,
      coords: {
        ...base.meta.coords,
        included,
        method: included ? 'stored-subset' : 'none',
        bounds: included
          ? (page?.meta.coords.bounds ?? pins?.meta.coords.bounds)
          : null,
      },
      total: page?.meta.total,
      next: page?.meta.next ?? null,
      span: page?.meta.span ?? null,
    },
    tags,
    nodes,
    links: [],
  }
}

// Papers per recipe page; matches the backend's _MAX_RANGE.
export const GRAPH_PAGE_SIZE = 500

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// "Papers 501–1,000 of 3,214 · Aug 12 – Sep 30 · 3 added" with Newer/Older
// arrows when the recipe has more than one page. `pageIndex` counts from 0.
export function pageLabel({
  pageIndex,
  pageSize,
  shown,
  total,
  span,
  pinnedOffPage,
}: {
  pageIndex: number
  pageSize: number
  shown: number
  total: number
  span?: { newest: string; oldest: string } | null
  pinnedOffPage: number
}): string {
  const parts: string[] = []
  if (total > shown || pageIndex > 0) {
    const first = pageIndex * pageSize + 1
    const last = pageIndex * pageSize + shown
    parts.push(
      `Papers ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`,
    )
  } else {
    parts.push(`${total.toLocaleString()} ${total === 1 ? 'paper' : 'papers'}`)
  }
  if (span && total > shown)
    parts.push(
      span.newest === span.oldest
        ? shortDate(span.newest)
        : `${shortDate(span.oldest)} – ${shortDate(span.newest)}`,
    )
  if (pinnedOffPage > 0) parts.push(`${pinnedOffPage} added`)
  return parts.join(' · ')
}
