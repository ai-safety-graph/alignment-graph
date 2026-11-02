import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import GenerateGraphModal from './GenerateGraphModal'
import { EMPTY_FILTERS } from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'

// Serves /api/tags and answers /api/papers with `totalFor(url)`.
function mockApi(totalFor: (url: URL) => number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      const body = url.pathname.endsWith('/api/tags')
        ? { rlhf: { size: 4 }, evals: { size: 2 } }
        : { total: totalFor(url), page: 1, limit: 1, items: [] }
      return { ok: true, status: 200, json: async () => body } as Response
    }),
  )
}

function renderModal(
  props: Partial<React.ComponentProps<typeof GenerateGraphModal>> = {},
) {
  const onGenerate = vi.fn<(f: GraphFilters) => void>()
  const onClose = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <GenerateGraphModal
        initialFilters={EMPTY_FILTERS}
        mode='generate'
        onGenerate={onGenerate}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onGenerate, onClose }
}

// jsdom lacks ResizeObserver, which the Radix date slider measures with.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GenerateGraphModal', () => {
  it('generates with the chosen filters', async () => {
    mockApi(() => 12)
    const { onGenerate } = renderModal()

    await userEvent.click(await screen.findByRole('button', { name: /rlhf/ }))
    const generate = screen.getByRole('button', { name: 'Generate graph' })
    await waitFor(() => expect(generate).toBeEnabled())
    await userEvent.click(generate)

    expect(onGenerate).toHaveBeenCalledWith({
      tags: ['rlhf'],
      domains: [],
      datePreset: 'all',
    })
  })

  it('seeds the form from initialFilters in edit mode', async () => {
    mockApi(() => 3)
    const initialFilters = { tags: ['evals'], domains: ['gov'], datePreset: 'all' as const }
    const { onGenerate } = renderModal({ initialFilters, mode: 'edit' })

    const regenerate = screen.getByRole('button', { name: 'Regenerate graph' })
    await waitFor(() => expect(regenerate).toBeEnabled())
    await userEvent.click(regenerate)

    expect(onGenerate).toHaveBeenCalledWith(initialFilters)
    const fetchMock = vi.mocked(fetch)
    const countUrl = new URL(
      fetchMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('/api/papers'))!,
      'http://localhost',
    )
    expect(countUrl.searchParams.getAll('tags')).toEqual(['evals'])
    expect(countUrl.searchParams.getAll('domain')).toEqual(['gov'])
  })

  it('disables Generate when nothing matches', async () => {
    mockApi(() => 0)
    renderModal()

    expect(await screen.findByText('No papers match these filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate graph' })).toBeDisabled()
  })

  it('closes on Escape', async () => {
    mockApi(() => 1)
    const { onClose } = renderModal()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
