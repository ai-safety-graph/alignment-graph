import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import {
  createSavedGraph,
  getSavedGraph,
  listSavedGraphs,
  MAX_PINNED,
  updateSavedGraph,
  withAdded,
  withRemoved,
} from './storage'

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function storeRaw(id: string, graph: object) {
  localStorage.setItem('ais_graphs', JSON.stringify([id]))
  localStorage.setItem(`ais_graph_${id}`, JSON.stringify(graph))
}

const DATES = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('saved graphs', () => {
  it('round-trips the filter recipe, pins and hides', () => {
    const filters = { tags: ['rlhf'], domains: ['gov'], datePreset: '1m' as const }
    const g = createSavedGraph('RLHF', { filters, pinned: ['a'], hidden: ['b'] })

    expect(getSavedGraph(g.id)).toMatchObject({ filters, pinned: ['a'], hidden: ['b'] })
    expect(listSavedGraphs().map((s) => s.id)).toEqual([g.id])
  })

  it('starts empty and updates membership and filters together', () => {
    const g = createSavedGraph('RLHF')
    expect(g).toMatchObject({ pinned: [], hidden: [] })
    const filters = { tags: [], domains: ['tech'], datePreset: 'all' as const }

    const updated = updateSavedGraph(g.id, { pinned: ['c'], filters })

    expect(getSavedGraph(g.id)).toEqual(updated)
    expect(updated).toMatchObject({ pinned: ['c'], hidden: [], filters })
  })

  it('caps pins, not the recipe', () => {
    const g = createSavedGraph('Big')
    const pins = Array.from({ length: MAX_PINNED + 1 }, (_, i) => `p${i}`)
    expect(() => updateSavedGraph(g.id, { pinned: pins })).toThrow()
  })

  it('turns a hand-built snapshot from before pins into pins', () => {
    storeRaw('old', { id: 'old', name: 'Old graph', paperIds: ['a', 'b'], ...DATES })

    const [g] = listSavedGraphs()
    expect(g).toMatchObject({ pinned: ['a', 'b'], hidden: [] })
    expect(g.filters).toBeUndefined()
    expect(g).not.toHaveProperty('paperIds')
  })

  it('drops the snapshot of a recipe graph, which the recipe reproduces', () => {
    const filters = { tags: ['rlhf'], domains: [], datePreset: 'all' as const }
    storeRaw('gen', { id: 'gen', name: 'Generated', paperIds: ['a'], filters, ...DATES })

    expect(listSavedGraphs()[0]).toMatchObject({ filters, pinned: [], hidden: [] })
  })
})

describe('membership edits', () => {
  it('adding pins once and un-hides', () => {
    const m = { pinned: ['a'], hidden: ['b'] }
    expect(withAdded(m, 'a')).toEqual({ pinned: ['a'], hidden: ['b'] })
    expect(withAdded(m, 'b')).toEqual({ pinned: ['a', 'b'], hidden: [] })
  })

  it('removing unpins, and hides only recipe matches', () => {
    const m = { pinned: ['a'], hidden: [] }
    expect(withRemoved(m, 'a', false)).toEqual({ pinned: [], hidden: [] })
    expect(withRemoved(m, 'r', true)).toEqual({ pinned: ['a'], hidden: ['r'] })
    expect(withRemoved({ pinned: ['r'], hidden: [] }, 'r', true)).toEqual({
      pinned: [],
      hidden: ['r'],
    })
  })
})
