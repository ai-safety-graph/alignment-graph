import { describe, expect, it } from 'vitest'
import { mergeGraphContent } from './graphContent'
import type { GraphDataCompact, NodeCompact } from './types'

function node(aid: string, tags: string[] = []): NodeCompact {
  return { id: 99, aid, t: aid, au: '', pd: '', dm: 'tech', ln: '', tags, x: 1, y: 2 }
}

function graph(nodes: NodeCompact[], meta: Partial<GraphDataCompact['meta']> = {}) {
  return {
    meta: {
      model: 'm',
      embedding_dim: 1,
      generated_at: '',
      neighbors: { top_k: 0, min_sim: 0 },
      coords: {
        included: true,
        method: 'stored-subset',
        canvas: { w: 1000, h: 700, pad: 24 },
        bounds: { x_min: 0, x_max: 1, y_min: 0, y_max: 1 },
      },
      compact: true,
      ...meta,
    },
    tags: {},
    nodes,
    links: [],
  } as GraphDataCompact
}

describe('mergeGraphContent', () => {
  it('is undefined until either half loads', () => {
    expect(mergeGraphContent(undefined, undefined, new Set())).toBeUndefined()
  })

  it('puts the page first, appends off-page pins, drops hidden, renumbers', () => {
    const page = graph([node('a', ['rlhf']), node('b'), node('c', ['rlhf'])], {
      total: 10,
      next: { before_date: '2024-01-01', before_id: 'c' },
      span: { newest: '2024-02-01', oldest: '2024-01-01' },
    })
    const pins = graph([node('b'), node('p', ['rlhf'])])

    const merged = mergeGraphContent(page, pins, new Set(['c']))!

    expect(merged.nodes.map((n) => [n.id, n.aid])).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'p'],
    ])
    expect(merged.tags).toEqual({ rlhf: { size: 2 } })
    expect(merged.meta.total).toBe(10)
    expect(merged.meta.next?.before_id).toBe('c')
    expect(merged.meta.span?.newest).toBe('2024-02-01')
  })

  it('serves a recipe-less graph from its pins alone', () => {
    const merged = mergeGraphContent(undefined, graph([node('p')]), new Set())!
    expect(merged.nodes.map((n) => n.aid)).toEqual(['p'])
    expect(merged.meta.next).toBeNull()
    expect(merged.meta.coords.included).toBe(true)
  })
})
