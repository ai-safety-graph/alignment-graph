import { describe, expect, it } from 'vitest'
import { buildAdjacency, clamp, lc } from './graph'
import type { LinkCompact, NodeCompact } from './types'

function makeNode(id: number): NodeCompact {
  return { id, aid: `aid-${id}`, t: '', au: '', pd: '', dm: '', ln: '', cid: 0 }
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
