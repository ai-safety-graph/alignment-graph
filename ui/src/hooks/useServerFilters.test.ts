import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { availableDatePresets } from './useServerFilters'

describe('availableDatePresets', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels the last notch "Past month" for a month of papers', () => {
    expect(availableDatePresets('2026-09-21')).toEqual([
      { value: '1w', label: 'Past week' },
      { value: '2w', label: 'Past 2 weeks' },
      { value: '3w', label: 'Past 3 weeks' },
      { value: 'all', label: 'Past month' },
    ])
  })

  it('labels the last notch with the narrowest window covering the data', () => {
    const presets = availableDatePresets('2025-01-01')
    expect(presets.at(-1)).toEqual({ value: 'all', label: 'Past 2 years' })
  })

  it('keeps "Any time" when data predates every window', () => {
    const presets = availableDatePresets('2010-01-01')
    expect(presets).toHaveLength(10)
    expect(presets.at(-1)).toEqual({ value: 'all', label: 'Any time' })
  })

  it('keeps "Any time" when no papers are loaded', () => {
    expect(availableDatePresets(undefined)).toEqual([
      { value: 'all', label: 'Any time' },
    ])
  })
})
