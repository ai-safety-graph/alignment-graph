import type { TagsLegend, GraphDataCompact, NodeCompact } from './types'

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = BASE_URL ? `${BASE_URL}${path}` : path
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

// Guards against a node-shaped payload missing `tags` -- e.g. an old API
// pod still serving a pre-tags schema during a rolling deploy. Every
// downstream consumer (canvas rendering, TagChips, tag filtering) assumes
// `tags` is always an array, so this is enforced once at the fetch boundary.
function withTags<T extends { tags?: string[] }>(n: T): T & { tags: string[] } {
  return { ...n, tags: n.tags ?? [] }
}

export type PaperDetail = NodeCompact & { sm: string }

export type SearchResult = NodeCompact & { sim: number | null }

export type SearchResponse = { query: string; results: SearchResult[] }

export type PaginatedPapers = {
  total: number
  page: number
  limit: number
  items: NodeCompact[]
}

export async function fetchSubgraph(
  paperIds: string[],
): Promise<GraphDataCompact> {
  const data = await apiFetch<GraphDataCompact>('/api/graph/subset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: paperIds }),
  })
  return { ...data, nodes: data.nodes.map(withTags) }
}

export async function fetchPaper(
  arxivUrl: string,
): Promise<PaperDetail | null> {
  try {
    const id = new URL(arxivUrl).pathname.replace(/^\/abs\//, '')
    const paper = await apiFetch<PaperDetail>(
      `/api/papers/${encodeURIComponent(id)}`,
    )
    return withTags(paper)
  } catch {
    return null
  }
}

export async function searchPapers(
  query: string,
  opts: { limit?: number; domain?: string; tag?: string } = {},
): Promise<SearchResponse> {
  const res = await apiFetch<SearchResponse>('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: opts.limit ?? 20, ...opts }),
  })
  return { ...res, results: res.results.map(withTags) }
}

export async function fetchPapers(
  params: {
    page?: number
    limit?: number
    tags?: string[]
    domains?: string[]
    from?: string
    to?: string
    q?: string
  } = {},
): Promise<PaginatedPapers> {
  const qs = new URLSearchParams()
  if (params.page != null) qs.set('page', String(params.page))
  if (params.limit != null) qs.set('limit', String(params.limit))
  params.tags?.forEach((t) => qs.append('tags', t))
  params.domains?.forEach((d) => qs.append('domain', d))
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.q) qs.set('q', params.q)
  const data = await apiFetch<PaginatedPapers>(`/api/papers?${qs}`)
  return { ...data, items: data.items.map(withTags) }
}

export async function fetchTags(): Promise<TagsLegend> {
  return apiFetch<TagsLegend>('/api/tags')
}

export type RelatedPaper = NodeCompact & {
  sim: number
  rx: number | null
  ry: number | null
}

export async function fetchRelated(
  arxivId: string,
  limit = 10,
): Promise<RelatedPaper[]> {
  const results = await apiFetch<RelatedPaper[]>(
    `/api/papers/related?id=${encodeURIComponent(arxivId)}&limit=${limit}`,
  )
  return results.map(withTags)
}

export type HealthResponse = { status: string; semantic_search: boolean }

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}
