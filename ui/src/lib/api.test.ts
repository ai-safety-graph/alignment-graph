import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPaper, fetchPapers } from './api'

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
      clusters: [1, 3],
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
    expect(url.searchParams.getAll('cluster')).toEqual(['1', '3'])
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
    expect(url.searchParams.has('cluster')).toBe(false)
    expect(url.searchParams.has('q')).toBe(false)
  })

  it('throws on a non-OK response', async () => {
    mockFetchOnce({}, { ok: false, status: 500 })
    await expect(fetchPapers()).rejects.toThrow('API 500')
  })
})

describe('fetchPaper', () => {
  beforeEach(() => {
    mockFetchOnce({ aid: 'x', t: 't', au: '', pd: '', ln: '', dm: '', cid: 0, sm: '' })
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
