import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import {
  createSavedGraph,
  getSavedGraph,
  listSavedGraphs,
  updateSavedGraph,
} from './storage'

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saved graphs', () => {
  it('round-trips the filter recipe', () => {
    const filters = { tags: ['rlhf'], domains: ['gov'], datePreset: '1m' as const }
    const g = createSavedGraph('RLHF', ['a', 'b'], filters)

    expect(getSavedGraph(g.id)?.filters).toEqual(filters)
    expect(listSavedGraphs().map((s) => s.id)).toEqual([g.id])
  })

  it('updates paperIds and filters together', () => {
    const g = createSavedGraph('RLHF', ['a'])
    const filters = { tags: [], domains: ['tech'], datePreset: 'all' as const }

    const updated = updateSavedGraph(g.id, { paperIds: ['c'], filters })

    expect(getSavedGraph(g.id)).toEqual(updated)
    expect(updated).toMatchObject({ paperIds: ['c'], filters })
  })

  it('reads graphs saved before filters existed', () => {
    const legacy = {
      id: 'old',
      name: 'Old graph',
      paperIds: ['a'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    localStorage.setItem('ais_graphs', JSON.stringify(['old']))
    localStorage.setItem('ais_graph_old', JSON.stringify(legacy))

    expect(listSavedGraphs()).toEqual([legacy])
    expect(listSavedGraphs()[0].filters).toBeUndefined()
  })
})
