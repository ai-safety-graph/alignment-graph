import { describe, expect, it } from 'vitest'
import {
  buildShareUrl,
  parseShareParams,
  shareParams,
  withoutShareParams,
  type SharedGraph,
} from './shareLink'
import { MAX_PINNED } from './storage'

const abs = (id: string) => `https://arxiv.org/abs/${id}`
const roundTrip = (g: SharedGraph) => parseShareParams(shareParams(g))

const RECIPE_GRAPH: SharedGraph = {
  name: 'My feed',
  filters: {
    tags: ['Interpretability, explainability', 'RLHF'],
    domains: ['cs.AI'],
    datePreset: '1m',
    peerReviewed: true,
    keywords: ['sparse autoencoder', '𝔼xpectation'],
    authors: ['Neel Nanda'],
  },
  pinned: [abs('2401.12345'), abs('cs/0601001'), abs('math.GT/0309136v2')],
  hidden: [abs('2312.00001')],
}

describe('share links', () => {
  it('round-trips a recipe graph with pins and hides', () => {
    expect(roundTrip(RECIPE_GRAPH)).toEqual(RECIPE_GRAPH)
  })

  it('round-trips a pins-only graph without inventing a recipe', () => {
    const g: SharedGraph = {
      name: 'Reading list',
      pinned: [abs('2401.00001')],
      hidden: [],
    }
    const parsed = roundTrip(g)
    expect(parsed).toEqual(g)
    expect(parsed).not.toHaveProperty('filters')
  })

  it('keeps an "all papers" recipe a recipe', () => {
    const g: SharedGraph = {
      name: 'Everything',
      filters: { tags: [], domains: [], datePreset: 'all' },
      pinned: [],
      hidden: [],
    }
    expect(roundTrip(g)).toEqual(g)
  })

  it('builds a link to the root route', () => {
    const url = buildShareUrl(RECIPE_GRAPH, 'https://example.com')
    expect(url.startsWith('https://example.com/?v=1&')).toBe(true)
    expect(parseShareParams(new URL(url).searchParams)).toEqual(RECIPE_GRAPH)
  })

  it('leaves out aids it cannot carry', () => {
    const qs = shareParams({
      name: 'x',
      pinned: [abs('2401.00001'), 'not-an-aid', abs('bad id')],
      hidden: [],
    })
    expect(qs.get('p')).toBe('2401.00001')
  })

  it('stays under a typical request-line limit at the pin cap', () => {
    const pinned = Array.from({ length: MAX_PINNED }, (_, i) =>
      abs(`2401.${String(10000 + i)}`),
    )
    const url = buildShareUrl(
      { ...RECIPE_GRAPH, pinned },
      'https://alignmentgraph.com',
    )
    expect(url.length).toBeLessThan(8000)
  })

  describe('parsing untrusted params', () => {
    const parse = (s: string) => parseShareParams(new URLSearchParams(s))

    it('ignores links that are not share links', () => {
      expect(parse('')).toBeNull()
      expect(parse('foo=bar')).toBeNull()
      expect(parse('v=2&w=1m')).toBeNull()
    })

    it('ignores a link with nothing to show', () => {
      expect(parse('v=1&n=Empty')).toBeNull()
      expect(parse('v=1&p=junk,also-junk')).toBeNull()
    })

    it('falls back to any time for an unknown date preset', () => {
      expect(parse('v=1&w=forever')?.filters?.datePreset).toBe('all')
    })

    it('drops invalid ids and duplicates, and caps pins', () => {
      expect(
        parse('v=1&p=2401.00001,../etc,2401.00001,cs/0601001')?.pinned,
      ).toEqual([abs('2401.00001'), abs('cs/0601001')])
      const many = Array.from(
        { length: MAX_PINNED + 100 },
        (_, i) => `2401.${10000 + i}`,
      )
      expect(parse(`v=1&p=${many.join(',')}`)?.pinned).toHaveLength(MAX_PINNED)
    })

    it('cleans terms the way the API would accept them', () => {
      const kws = ['ab', '  spaced   out ', 'Spaced Out', 'x'.repeat(81)]
      const qs = new URLSearchParams('v=1&w=all')
      for (const k of kws) qs.append('k', k)
      for (let i = 0; i < 15; i++) qs.append('a', `Author ${i}`)
      const f = parseShareParams(qs)?.filters
      expect(f?.keywords).toEqual(['spaced out'])
      expect(f?.authors).toHaveLength(10)
    })

    it('omits empty term lists and a false peer-review flag', () => {
      const f = parse('v=1&w=1w&k=&pr=0')?.filters
      expect(f).toEqual({ tags: [], domains: [], datePreset: '1w' })
    })

    it('names an unnamed link after its recipe', () => {
      expect(parse('v=1&w=all&a=Neel+Nanda')?.name).toBe('Neel Nanda')
      expect(parse('v=1&p=2401.00001')?.name).toBe('Shared graph')
    })

    it('truncates a long name', () => {
      expect(parse(`v=1&w=all&n=${'x'.repeat(100)}`)?.name).toHaveLength(40)
    })
  })

  it('strips only the share params', () => {
    expect(withoutShareParams('?v=1&n=x&p=2401.00001&utm_source=mail')).toBe(
      '?utm_source=mail',
    )
    expect(withoutShareParams('?v=1&w=all')).toBe('')
  })
})
