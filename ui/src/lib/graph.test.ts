import { describe, expect, it } from 'vitest'
import { buildAdjacency, clamp, lc, nodeMatchesFilters } from './graph'
import type { LinkCompact, NodeCompact } from './types'

function makeNode(id: number): NodeCompact {
  return { id, aid: `aid-${id}`, t: '', au: '', pd: '', dm: '', ln: '', tags: [] }
}

describe('clamp', () => {
  it('clamps values within the given bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })
})

describe('lc', () => {
  it('lowercases strings', () => {
    expect(lc('AI Safety')).toBe('ai safety')
  })

  it('treats null/undefined as an empty string', () => {
    expect(lc(null)).toBe('')
    expect(lc(undefined)).toBe('')
  })
})

describe('buildAdjacency', () => {
  it('builds a bidirectional adjacency list sorted by weight descending', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)]
    const links: LinkCompact[] = [
      { s: 1, t: 2, w: 0.5 },
      { s: 1, t: 3, w: 0.9 },
    ]

    const { byId, adj } = buildAdjacency(nodes, links)

    expect(byId.get(1)).toEqual(nodes[0])

    const neighborsOf1 = adj.get(1)
    expect(neighborsOf1).toEqual([
      { id: 3, w: 0.9 },
      { id: 2, w: 0.5 },
    ])
    expect(adj.get(2)).toEqual([{ id: 1, w: 0.5 }])
    expect(adj.get(3)).toEqual([{ id: 1, w: 0.9 }])
  })

  it('gives every node an (empty) adjacency entry, even with no links', () => {
    const nodes = [makeNode(1), makeNode(2)]
    const { adj } = buildAdjacency(nodes, [])
    expect(adj.get(1)).toEqual([])
    expect(adj.get(2)).toEqual([])
  })
})

describe('nodeMatchesFilters', () => {
  const node = {
    ...makeNode(1),
    tags: ['interpretability', 'evals'],
    dm: 'tech',
    pd: '2026-09-01',
  }
  const none = { tags: new Set<string>(), domains: new Set<string>() }

  it('matches everything when no filters are active', () => {
    expect(nodeMatchesFilters(node, none)).toBe(true)
  })

  it('matches if the node has any selected tag', () => {
    expect(
      nodeMatchesFilters(node, { ...none, tags: new Set(['evals', 'policy']) }),
    ).toBe(true)
    expect(
      nodeMatchesFilters(node, { ...none, tags: new Set(['policy']) }),
    ).toBe(false)
  })

  it('matches if the node domain is selected', () => {
    expect(
      nodeMatchesFilters(node, { ...none, domains: new Set(['tech', 'gov']) }),
    ).toBe(true)
    expect(
      nodeMatchesFilters(node, { ...none, domains: new Set(['gov']) }),
    ).toBe(false)
  })

  it('matches papers published on or after fromDate', () => {
    expect(nodeMatchesFilters(node, { ...none, fromDate: '2026-09-01' })).toBe(
      true,
    )
    expect(nodeMatchesFilters(node, { ...none, fromDate: '2026-09-02' })).toBe(
      false,
    )
  })

  it('compares only the date part of a timestamp pd', () => {
    const ts = { ...node, pd: '2026-09-01 12:30:00' }
    expect(nodeMatchesFilters(ts, { ...none, fromDate: '2026-09-01' })).toBe(
      true,
    )
  })

  it('excludes papers with no published date when a date filter is set', () => {
    const noDate = { ...node, pd: '' }
    expect(nodeMatchesFilters(noDate, { ...none, fromDate: '2026-01-01' })).toBe(
      false,
    )
  })

  it('requires every active filter group to match', () => {
    const f = {
      tags: new Set(['evals']),
      domains: new Set(['gov']),
      fromDate: '2026-01-01',
    }
    expect(nodeMatchesFilters(node, f)).toBe(false)
    expect(nodeMatchesFilters(node, { ...f, domains: new Set(['tech']) })).toBe(
      true,
    )
  })
})
