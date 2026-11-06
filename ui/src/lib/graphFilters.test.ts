import { describe, expect, it } from 'vitest'
import {
  defaultGraphName,
  EMPTY_FILTERS,
  filterSummary,
  toRangeParams,
} from './graphFilters'

describe('toRangeParams', () => {
  it('omits `from` for any-time and passes tags/domains through', () => {
    // A recipe saved before the peer-review toggle existed means all papers
    expect(toRangeParams({ tags: ['rlhf'], domains: ['gov'], datePreset: 'all' })).toEqual({
      from: undefined,
      tags: ['rlhf'],
      domains: ['gov'],
      peerReviewed: false,
    })
  })

  it('passes the peer-review toggle through', () => {
    expect(toRangeParams({ ...EMPTY_FILTERS, peerReviewed: true }).peerReviewed).toBe(true)
  })

  it('resolves the preset to an ISO date', () => {
    const { from } = toRangeParams({ ...EMPTY_FILTERS, datePreset: '1m' })
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('defaultGraphName', () => {
  it('names by first tag, extra tag count and date window', () => {
    expect(
      defaultGraphName({ tags: ['rlhf', 'evals'], domains: [], datePreset: '1m' }, 40),
    ).toBe('Rlhf +1 · past month')
  })

  it('marks peer-reviewed recipes', () => {
    expect(
      defaultGraphName({ tags: ['rlhf'], domains: [], datePreset: '1m', peerReviewed: true }, 60),
    ).toBe('Rlhf · past month · peer-reviewed')
  })

  it('falls back to domains, then all papers', () => {
    expect(defaultGraphName({ ...EMPTY_FILTERS, domains: ['gov'] }, 40)).toBe('Governance')
    expect(defaultGraphName(EMPTY_FILTERS, 40)).toBe('All papers')
  })

  it('clips to the max length', () => {
    const name = defaultGraphName(
      { tags: ['interpretability and explainability'], domains: [], datePreset: '3m' },
      20,
    )
    expect(name).toHaveLength(20)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('filterSummary', () => {
  it('lists peer review, the date window, then a topic count', () => {
    expect(
      filterSummary({
        tags: ['rlhf', 'interpretability'],
        domains: ['gov'],
        datePreset: '1w',
        peerReviewed: true,
      }),
    ).toEqual(['Peer-reviewed', 'Past week', '2 topics'])
  })

  it('says "1 topic" and leaves out filters that are not set', () => {
    expect(
      filterSummary({ tags: ['rlhf'], domains: [], datePreset: 'all' }),
    ).toEqual(['1 topic'])
    expect(filterSummary(EMPTY_FILTERS)).toEqual([])
  })
})
