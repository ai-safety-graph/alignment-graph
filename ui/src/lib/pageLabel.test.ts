import { describe, expect, it } from 'vitest'
import { pageLabel } from './graphContent'

const base = { pageIndex: 0, pageSize: 500, pinned: 0 }

describe('pageLabel', () => {
  it('gives a plain count when everything fits on one page', () => {
    expect(pageLabel({ ...base, shown: 42, total: 42 })).toBe('42 papers')
    expect(pageLabel({ ...base, shown: 1, total: 1 })).toBe('1 paper')
  })

  it('gives the range, total and date span when paged', () => {
    const label = pageLabel({
      ...base,
      pageIndex: 1,
      shown: 500,
      total: 3214,
      span: { newest: '2026-09-30', oldest: '2026-08-12' },
    })
    expect(label).toMatch(/^Papers 501–1,000 of 3,214 · /)
    expect(label).toContain('Aug')
    expect(label).toContain('Sep')
  })

  it('counts pinned papers', () => {
    expect(pageLabel({ ...base, shown: 3, total: 3, pinned: 2 })).toBe(
      '3 papers · 2 pinned',
    )
  })
})
