import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GraphLegend from './GraphLegend'
import { memoryStorage } from '../test/memoryStorage'

const KEY = 'ais_legend_collapsed'

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GraphLegend', () => {
  it('renders expanded with every swatch label', () => {
    render(<GraphLegend />)
    expect(screen.getByText('Papers in this graph')).toBeInTheDocument()
    expect(
      screen.getByText('Search results outside this graph'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Papers related to the selected one'),
    ).toBeInTheDocument()
  })

  it('collapses and remembers it', async () => {
    render(<GraphLegend />)
    await userEvent.click(screen.getByLabelText('Collapse legend'))
    expect(screen.queryByText('Papers in this graph')).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe('1')

    await userEvent.click(screen.getByRole('button', { name: 'Legend' }))
    expect(screen.getByText('Papers in this graph')).toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('starts collapsed when the choice was saved', () => {
    localStorage.setItem(KEY, '1')
    render(<GraphLegend />)
    expect(screen.queryByText('Papers in this graph')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument()
  })

  it('still works when storage throws', async () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    })
    render(<GraphLegend />)
    expect(screen.getByText('Papers in this graph')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Collapse legend'))
    expect(screen.queryByText('Papers in this graph')).not.toBeInTheDocument()
  })
})
