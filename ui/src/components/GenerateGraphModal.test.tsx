import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import GenerateGraphModal from './GenerateGraphModal'
import { EMPTY_FILTERS } from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'

// Serves /api/tags and /api/authors, and answers /api/papers with
// `totalFor(url)`.
function mockApi(totalFor: (url: URL) => number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      const body = url.pathname.endsWith('/api/tags')
        ? { rlhf: { size: 4 }, evals: { size: 2 } }
        : url.pathname.endsWith('/api/authors')
          ? [
              { name: 'Neel Nanda', n: 44 },
              { name: 'Nanyun Peng', n: 18 },
              // Longer than the API's 80-character author term
              { name: `Nanda ${'X'.repeat(80)}`, n: 1 },
            ].filter((a) => a.name.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()))
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

  it('applies the peer-review toggle to the count and the recipe', async () => {
    mockApi((url) => (url.searchParams.get('peer_reviewed') === 'true' ? 2 : 12))
    const { onGenerate } = renderModal()

    await userEvent.click(await screen.findByRole('button', { name: /Peer-reviewed only/ }))
    expect(await screen.findByText('2 papers match')).toBeInTheDocument()
    const generate = screen.getByRole('button', { name: 'Generate graph' })
    await waitFor(() => expect(generate).toBeEnabled())
    await userEvent.click(generate)

    expect(onGenerate).toHaveBeenCalledWith({
      tags: [],
      domains: [],
      datePreset: 'all',
      peerReviewed: true,
    })
  })

  it('disables Generate when nothing matches', async () => {
    mockApi(() => 0)
    renderModal()

    expect(await screen.findByText('No papers match these filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate graph' })).toBeDisabled()
  })

  it('saves under a name that follows the filters until typed over', async () => {
    mockApi(() => 5)
    const onSave = vi.fn<(f: GraphFilters, name: string) => string | null>(() => null)
    const { onGenerate } = renderModal({ onSave })

    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('All papers')
    await userEvent.click(await screen.findByRole('button', { name: /rlhf/ }))
    expect(name).toHaveValue('Rlhf')

    await userEvent.clear(name)
    await userEvent.type(name, 'Mine')
    const create = screen.getByRole('button', { name: 'Create graph' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.click(create)

    expect(onSave).toHaveBeenCalledWith(
      { tags: ['rlhf'], domains: [], datePreset: 'all' },
      'Mine',
    )
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('shows the error when saving fails', async () => {
    mockApi(() => 5)
    renderModal({ onSave: () => 'Maximum 50 saved graphs reached' })

    const create = screen.getByRole('button', { name: 'Create graph' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.click(create)

    expect(screen.getByText('Maximum 50 saved graphs reached')).toBeInTheDocument()
  })

  it('adds a keyword on Enter without generating, and counts with it', async () => {
    mockApi((url) => (url.searchParams.getAll('kw').includes('sparse autoencoder') ? 7 : 12))
    const { onGenerate } = renderModal()

    const input = screen.getByRole('combobox', { name: 'Keywords and authors' })
    await userEvent.type(input, 'sparse  autoencoder{Enter}')
    expect(onGenerate).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Remove keyword sparse autoencoder' })).toBeInTheDocument()
    expect(await screen.findByText('7 papers match')).toBeInTheDocument()

    // Enter on the empty box generates, as anywhere else in the modal
    const generate = screen.getByRole('button', { name: 'Generate graph' })
    await waitFor(() => expect(generate).toBeEnabled())
    await userEvent.keyboard('{Enter}')
    expect(onGenerate).toHaveBeenCalledWith({
      tags: [],
      domains: [],
      datePreset: 'all',
      keywords: ['sparse autoencoder'],
    })
  })

  it('suggests authors from the corpus and adds the chosen one', async () => {
    mockApi((url) => (url.searchParams.getAll('author').includes('Neel Nanda') ? 44 : 12))
    const { onGenerate } = renderModal()

    const input = screen.getByRole('combobox', { name: 'Keywords and authors' })
    await userEvent.type(input, 'nanda')
    // The typed text as a keyword comes first, then the suggestion
    const suggestion = await screen.findByRole('option', { name: /Neel Nanda/ })
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Keyword “nanda”')
    expect(suggestion).toHaveTextContent('44 papers')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByRole('button', { name: 'Remove author Neel Nanda' })).toBeInTheDocument()
    expect(await screen.findByText('44 papers match')).toBeInTheDocument()
    const generate = screen.getByRole('button', { name: 'Generate graph' })
    await waitFor(() => expect(generate).toBeEnabled())
    await userEvent.click(generate)
    expect(onGenerate).toHaveBeenCalledWith({ tags: [], domains: [], datePreset: 'all', authors: ['Neel Nanda'] })
  })

  it('offers a short name only as an author, without looking it up', async () => {
    mockApi(() => 3)
    renderModal()

    await userEvent.type(screen.getByRole('combobox', { name: 'Keywords and authors' }), 'Yu')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Author “Yu”')
    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('/api/authors'))).toBe(false)
  })

  it('removes the last chip on Backspace and clears typed text on Escape', async () => {
    mockApi(() => 3)
    const { onClose } = renderModal({
      initialFilters: { ...EMPTY_FILTERS, keywords: ['jailbreak'], authors: ['Neel Nanda'] },
      mode: 'edit',
    })

    const input = screen.getByRole('combobox', { name: 'Keywords and authors' })
    await userEvent.type(input, 'abc{Escape}')
    expect(input).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByRole('button', { name: 'Remove keyword jailbreak' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove author Neel Nanda' })).toBeInTheDocument()
  })

  it('does not remove chips on a held Backspace', async () => {
    mockApi(() => 3)
    renderModal({
      initialFilters: { ...EMPTY_FILTERS, keywords: ['jailbreak'], authors: ['Neel Nanda'] },
      mode: 'edit',
    })

    const input = screen.getByRole('combobox', { name: 'Keywords and authors' })
    fireEvent.keyDown(input, { key: 'Backspace', repeat: true })
    expect(screen.getByRole('button', { name: 'Remove keyword jailbreak' })).toBeInTheDocument()
  })

  it('leaves Enter to the IME while composing', async () => {
    mockApi(() => 3)
    const { onGenerate } = renderModal()

    const input = screen.getByRole('combobox', { name: 'Keywords and authors' })
    await userEvent.type(input, 'abcd')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(input).toHaveValue('abcd')
    expect(screen.queryByRole('button', { name: /Remove keyword/ })).not.toBeInTheDocument()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('counts characters as the API does, not UTF-16 units', async () => {
    mockApi(() => 3)
    renderModal()

    // Two characters, three UTF-16 units: too short for a keyword
    await userEvent.type(screen.getByRole('combobox', { name: 'Keywords and authors' }), '𝔼x')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Author “𝔼x”')
  })

  it('leaves out suggested names longer than an author term can be', async () => {
    mockApi(() => 3)
    renderModal()

    await userEvent.type(screen.getByRole('combobox', { name: 'Keywords and authors' }), 'nanda')
    await screen.findByRole('option', { name: /Neel Nanda/ })
    expect(screen.queryByRole('option', { name: /XXXX/ })).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    mockApi(() => 1)
    const { onClose } = renderModal()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
