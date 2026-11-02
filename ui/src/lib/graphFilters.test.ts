import { describe, expect, it } from 'vitest'
import { defaultGraphName, EMPTY_FILTERS, toRangeParams } from './graphFilters'

describe('toRangeParams', () => {
  it('omits `from` for any-time and passes tags/domains through', () => {
    expect(toRangeParams({ tags: ['rlhf'], domains: ['gov'], datePreset: 'all' })).toEqual({
      from: undefined,
      tags: ['rlhf'],
      domains: ['gov'],
    })
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
