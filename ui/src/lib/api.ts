import type { TagsLegend, GraphDataCompact, NodeCompact } from './types'

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = BASE_URL ? `${BASE_URL}${path}` : path
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
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
  return apiFetch<GraphDataCompact>('/api/graph/subset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: paperIds }),
  })
}

export async function fetchPaper(
  arxivUrl: string,
): Promise<PaperDetail | null> {
  try {
    const id = new URL(arxivUrl).pathname.replace(/^\/abs\//, '')
    return await apiFetch<PaperDetail>(`/api/papers/${encodeURIComponent(id)}`)
  } catch {
    return null
  }
}

export async function searchPapers(
  query: string,
  opts: { limit?: number; domain?: string; tag?: string } = {},
): Promise<SearchResponse> {
  return apiFetch<SearchResponse>('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: opts.limit ?? 20, ...opts }),
  })
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
  return apiFetch<PaginatedPapers>(`/api/papers?${qs}`)
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
  return apiFetch<RelatedPaper[]>(
    `/api/papers/related?id=${encodeURIComponent(arxivId)}&limit=${limit}`,
  )
}

export type HealthResponse = { status: string; semantic_search: boolean }

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}
