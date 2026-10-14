import { afterEach, describe, expect, it, vi } from 'vitest'
import { initAnalytics, track } from './analytics'

afterEach(() => {
  delete window.umami
  document.head.innerHTML = ''
})

describe('track', () => {
  it('is a no-op when Umami has not loaded', () => {
    expect(() => track('paper_open')).not.toThrow()
  })

  it('forwards events to Umami', () => {
    const spy = vi.fn()
    window.umami = { track: spy }
    track('paper_open', { view: 'graph' })
    expect(spy).toHaveBeenCalledWith('paper_open', { view: 'graph' })
  })

  it('swallows errors from Umami', () => {
    window.umami = {
      track: () => {
        throw new Error('blocked')
      },
    }
    expect(() => track('paper_open')).not.toThrow()
  })
})

describe('initAnalytics', () => {
  it('injects nothing without a website id', () => {
    initAnalytics(undefined, true)
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('injects nothing outside production', () => {
    initAnalytics('abc', false)
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('injects the Umami script with the website id', () => {
    initAnalytics('abc', true)
    const s = document.head.querySelector('script')!
    expect(s.src).toBe('https://cloud.umami.is/script.js')
    expect(s.dataset.websiteId).toBe('abc')
    expect(s.dataset.domains).toBe('alignmentgraph.com')
  })
})
