import { describe, expect, it } from 'vitest'
import { domainLabel } from './domain'

describe('domainLabel', () => {
  it('maps known domain codes to their labels', () => {
    expect(domainLabel('gov')).toBe('governance')
    expect(domainLabel('tech')).toBe('technology')
    expect(domainLabel('both')).toBe('gov/tech')
    expect(domainLabel('unknown')).toBe('unknown')
  })

  it('passes through unrecognized codes unchanged', () => {
    expect(domainLabel('mystery')).toBe('mystery')
  })
})
