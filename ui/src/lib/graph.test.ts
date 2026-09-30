import { describe, expect, it } from 'vitest'
import {
  buildAdjacency,
  clamp,
  lc,
  nodeMatchesFilters,
  separatePoints,
} from './graph'
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

describe('separatePoints', () => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)

  it('pushes a point off an obstacle it overlaps', () => {
    const obstacle = { x: 100, y: 100 }
    const [p] = separatePoints([{ x: 102, y: 100 }], {
      minDist: 10,
      fixed: [obstacle],
    })
    expect(dist(p, obstacle)).toBeGreaterThanOrEqual(9.9)
  })

  it('pushes overlapping points apart from each other', () => {
    const [a, b] = separatePoints(
      [
        { x: 50, y: 50 },
        { x: 51, y: 50 },
      ],
      { minDist: 10 },
    )
    expect(dist(a, b)).toBeGreaterThanOrEqual(9.9)
  })

  it('gives the same result when far-away obstacles are added', () => {
    const points = [
      { x: 100, y: 100 },
      { x: 104, y: 101 },
    ]
    const near = [
      { x: 108, y: 100 },
      { x: 100, y: 92 },
    ]
    // A dense grid well outside any point's neighbourhood.
    const far = Array.from({ length: 400 }, (_, i) => ({
      x: 500 + (i % 20) * 10,
      y: 500 + Math.floor(i / 20) * 10,
    }))
    expect(
      separatePoints(points, { minDist: 10, fixed: [...near, ...far] }),
    ).toEqual(separatePoints(points, { minDist: 10, fixed: near }))
  })

  it('returns an empty list for no points', () => {
    expect(
      separatePoints([], { minDist: 10, fixed: [{ x: 0, y: 0 }] }),
    ).toEqual([])
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
