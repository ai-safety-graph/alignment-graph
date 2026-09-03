import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 200))
    expect(result.current).toBe('a')
  })

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('a')
  })

  it('updates to the latest value once the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('b')
  })

  it('resets the timer on rapid successive changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    act(() => vi.advanceTimersByTime(150))
    rerender({ value: 'c' })
    act(() => vi.advanceTimersByTime(150))
    // Only 150ms have passed since 'c' was set, so it shouldn't have committed yet.
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(50))
    expect(result.current).toBe('c')
  })
})
