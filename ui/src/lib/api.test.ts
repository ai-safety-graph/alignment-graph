import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllPapers, fetchPaper, fetchPapers, fetchTags } from './api'

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init
  const response = { ok, status, statusText: 'status', json: async () => body } as Response
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  return response
}

describe('fetchPapers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds a query string with pagination and repeated filter params', async () => {
    mockFetchOnce({ total: 0, page: 1, limit: 50, items: [] })

    await fetchPapers({
      page: 2,
      limit: 25,
      tags: ['reward hacking', 'rlhf'],
      domains: ['gov', 'tech'],
      from: '2024-01-01',
      to: '2024-06-01',
      q: 'reward hacking',
    })

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    const url = new URL(calledUrl, 'http://localhost')
    expect(url.pathname).toBe('/api/papers')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.getAll('tags')).toEqual(['reward hacking', 'rlhf'])
    expect(url.searchParams.getAll('domain')).toEqual(['gov', 'tech'])
    expect(url.searchParams.get('from')).toBe('2024-01-01')
    expect(url.searchParams.get('to')).toBe('2024-06-01')
    expect(url.searchParams.get('q')).toBe('reward hacking')
  })

  it('omits unset params entirely', async () => {
    mockFetchOnce({ total: 0, page: 1, limit: 50, items: [] })

    await fetchPapers()

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    const url = new URL(calledUrl, 'http://localhost')
    expect(url.searchParams.has('tags')).toBe(false)
    expect(url.searchParams.has('q')).toBe(false)
  })

  it('throws on a non-OK response', async () => {
    mockFetchOnce({}, { ok: false, status: 500 })
    await expect(fetchPapers()).rejects.toThrow('API 500')
  })
})

describe('fetchAllPapers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches every page and concatenates items in page order', async () => {
    const node = (aid: string) => ({ aid, t: '', au: '', pd: '', ln: '', dm: '', tags: [] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const page = Number(new URL(input, 'http://localhost').searchParams.get('page'))
        const items = page < 3 ? [node(`p${page}a`), node(`p${page}b`)] : [node('p3a')]
        return { ok: true, status: 200, json: async () => ({ total: 401, page, limit: 200, items }) } as Response
      }),
    )

    const papers = await fetchAllPapers({ from: '2024-01-01' })

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
    const urls = vi.mocked(fetch).mock.calls.map((c) => new URL(c[0] as string, 'http://localhost'))
    expect(urls.map((u) => u.searchParams.get('page'))).toEqual(['1', '2', '3'])
    expect(urls.every((u) => u.searchParams.get('limit') === '200')).toBe(true)
    expect(urls.every((u) => u.searchParams.get('from') === '2024-01-01')).toBe(true)
    expect(papers.map((p) => p.aid)).toEqual(['p1a', 'p1b', 'p2a', 'p2b', 'p3a'])
  })

  it('makes a single request when everything fits on one page', async () => {
    mockFetchOnce({ total: 0, page: 1, limit: 200, items: [] })
    expect(await fetchAllPapers()).toEqual([])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('fetchPaper', () => {
  beforeEach(() => {
    mockFetchOnce({ aid: 'x', t: 't', au: '', pd: '', ln: '', dm: '', tags: [], sm: '' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts the bare id from a full arXiv abs URL', async () => {
    await fetchPaper('https://arxiv.org/abs/2401.01234')
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/papers/2401.01234')
  })

  it('returns null for a malformed URL instead of throwing', async () => {
    const result = await fetchPaper('not-a-url')
    expect(result).toBeNull()
  })
})

describe('fetchTags', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the tag legend keyed by tag string', async () => {
    mockFetchOnce({ 'reward hacking': { size: 3, primary_size: 2 } })
    const result = await fetchTags()
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/tags')
    expect(result).toEqual({ 'reward hacking': { size: 3, primary_size: 2 } })
  })
})
