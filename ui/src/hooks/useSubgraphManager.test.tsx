import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import {
  createSavedGraph,
  getActiveGraphId,
  listSavedGraphs,
  setActiveGraphId,
} from '../lib/storage'
import { SHARED_DRAFT_ID, useSubgraphManager } from './useSubgraphManager'

const SHARE = '/?v=1&n=Feed&w=1m&k=sparse+autoencoder&p=2401.00001&utm=x'

function setup(url: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return renderHook(
    () => ({ manager: useSubgraphManager(), location: useLocation() }),
    { wrapper },
  )
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSubgraphManager with a share link', () => {
  it('shows the shared graph read-only, without storing anything', () => {
    const { result } = setup(SHARE)
    const m = result.current.manager
    expect(m.isSharedDraft).toBe(true)
    expect(m.selectedSubgraphId).toBe(SHARED_DRAFT_ID)
    expect(m.selectedSubgraph?.name).toBe('Feed')
    expect(m.selectedSubgraph?.filters?.keywords).toEqual([
      'sparse autoencoder',
    ])
    expect(m.viewMode).toBe('matches')

    act(() => m.addToSelectedSubgraph('https://arxiv.org/abs/2401.00002'))
    expect(result.current.manager.selectedSubgraph?.pinned).toEqual([
      'https://arxiv.org/abs/2401.00001',
    ])
    expect(listSavedGraphs()).toHaveLength(0)
    expect(getActiveGraphId()).toBeNull()
  })

  it('saves it under a chosen name and drops the link from the URL', () => {
    const { result } = setup(SHARE)
    act(() => {
      expect(result.current.manager.saveSharedDraft('Mine')).toBeNull()
    })
    const [saved] = listSavedGraphs()
    expect(saved.name).toBe('Mine')
    expect(saved.pinned).toEqual(['https://arxiv.org/abs/2401.00001'])
    expect(saved.filters?.datePreset).toBe('1m')
    expect(result.current.manager.isSharedDraft).toBe(false)
    expect(result.current.manager.selectedSubgraphId).toBe(saved.id)
    expect(getActiveGraphId()).toBe(saved.id)
    expect(result.current.location.search).toBe('?utm=x')
  })

  it('discarding goes back to the graph selected before', () => {
    const own = createSavedGraph('Own', {
      pinned: ['https://arxiv.org/abs/2401.00009'],
    })
    setActiveGraphId(own.id)
    const { result } = setup(SHARE)
    expect(result.current.manager.isSharedDraft).toBe(true)
    act(() => result.current.manager.discardSharedDraft())
    expect(result.current.manager.selectedSubgraphId).toBe(own.id)
    expect(result.current.manager.isSharedDraft).toBe(false)
    expect(result.current.location.search).toBe('?utm=x')
    expect(listSavedGraphs()).toHaveLength(1)
  })

  it('picking another graph drops the shared one', () => {
    const { result } = setup(SHARE)
    act(() => result.current.manager.setSelectedSubgraphId(null))
    expect(result.current.manager.isSharedDraft).toBe(false)
    expect(result.current.manager.selectedSubgraph).toBeUndefined()
    expect(result.current.location.search).toBe('?utm=x')
  })

  it('ignores a URL that is not a share link', () => {
    const { result } = setup('/?foo=bar')
    expect(result.current.manager.isSharedDraft).toBe(false)
    expect(result.current.manager.selectedSubgraphId).toBeNull()
  })
})
