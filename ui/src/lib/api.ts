import type { ClustersLegend, GraphDataCompact, NodeCompact } from './types'

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

export async function fetchSubgraph(paperIds: string[]): Promise<GraphDataCompact> {
  return apiFetch<GraphDataCompact>('/api/graph/subset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: paperIds }),
  })
}

export async function fetchPaper(arxivUrl: string): Promise<PaperDetail | null> {
  try {
    const id = arxivUrl.replace('https://arxiv.org/abs/', '')
    return await apiFetch<PaperDetail>(`/api/papers/${encodeURIComponent(id)}`)
  } catch {
    return null
  }
}

export async function searchPapers(
  query: string,
  opts: { limit?: number; domain?: string; cluster?: number } = {},
): Promise<SearchResponse> {
  return apiFetch<SearchResponse>('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: opts.limit ?? 20, ...opts }),
  })
}

export async function fetchPapers(params: {
  page?: number
  limit?: number
  cluster?: number
  domain?: string
  from?: string
  to?: string
} = {}): Promise<PaginatedPapers> {
  const q = new URLSearchParams()
  if (params.page != null) q.set('page', String(params.page))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.cluster != null) q.set('cluster', String(params.cluster))
  if (params.domain) q.set('domain', params.domain)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  return apiFetch<PaginatedPapers>(`/api/papers?${q}`)
}

export async function fetchClusters(): Promise<ClustersLegend> {
  type Row = { cid: number; label: string | null; size: number }
  const rows = await apiFetch<Row[]>('/api/clusters')
  const legend: ClustersLegend = {}
  for (const r of rows) legend[String(r.cid)] = { label: r.label, size: r.size }
  return legend
}

export async function fetchAllPapers(): Promise<NodeCompact[]> {
  const PAGE_SIZE = 200
  const first = await fetchPapers({ page: 1, limit: PAGE_SIZE })
  const totalPages = Math.ceil(first.total / PAGE_SIZE)
  const allItems = totalPages <= 1
    ? first.items
    : [...first.items, ...await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          fetchPapers({ page: i + 2, limit: PAGE_SIZE }),
        ),
      ).then((pages) => pages.flatMap((r) => r.items))]
  return allItems.map((item, i) => ({ ...item, id: i }))
}

export type RelatedPaper = NodeCompact & { sim: number }

export async function fetchRelated(arxivId: string, limit = 10): Promise<RelatedPaper[]> {
  return apiFetch<RelatedPaper[]>(
    `/api/papers/related?id=${encodeURIComponent(arxivId)}&limit=${limit}`,
  )
}

export const hasApi = () => Boolean(BASE_URL)
