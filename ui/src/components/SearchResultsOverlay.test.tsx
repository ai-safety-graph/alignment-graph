import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SearchResultsOverlay from './SearchResultsOverlay'
import type { NodeCompact } from '../lib/types'

const node = (aid: string): NodeCompact => ({
  id: 0,
  aid,
  t: `Paper ${aid}`,
  au: 'A. Author',
  pd: '2026-01-01',
  dm: 'cs.AI',
  ln: aid,
  tags: [],
})

const results = [
  { n: node('a'), score: 1, deg: 0 },
  { n: node('b'), score: 1, deg: 0 },
]

afterEach(cleanup)

describe('SearchResultsOverlay', () => {
  it('blocks adding to a full graph but still allows removing', async () => {
    const onAdd = vi.fn()
    const onRemove = vi.fn()
    render(
      <SearchResultsOverlay
        results={results}
        onSelect={() => {}}
        onAddToSubgraph={onAdd}
        onRemoveFromSubgraph={onRemove}
        subgraphPaperIds={new Set(['a'])}
        subgraphName='Mine'
        subgraphFull
      />,
    )

    const add = screen.getByLabelText('Pin to Mine')
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', 'Mine already has 500 pinned papers')
    await userEvent.click(add)
    expect(onAdd).not.toHaveBeenCalled()

    await userEvent.click(screen.getByLabelText('Unpin from Mine'))
    expect(onRemove).toHaveBeenCalledWith('a')
  })

  it('shows the venue badge only for known peer-reviewed papers', () => {
    render(
      <SearchResultsOverlay
        results={[
          { n: { ...node('r'), pr: true, vn: 'ICLR 2026' }, score: 1, deg: 0 },
          { n: { ...node('u'), pr: false, vn: null }, score: 1, deg: 0 },
        ]}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('ICLR 2026')).toBeTruthy()
    expect(screen.getAllByTitle(/Peer-reviewed/)).toHaveLength(1)
  })

  it('shows the publication date, and nothing when it is missing', () => {
    render(
      <SearchResultsOverlay
        results={[
          { n: { ...node('d'), pd: '2026-10-31' }, score: 1, deg: 0 },
          { n: { ...node('e'), pd: '' }, score: 1, deg: 0 },
        ]}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('2026-10-31')).toBeTruthy()
    expect(screen.getAllByText(/^\d{4}-\d{2}-\d{2}$/)).toHaveLength(1)
  })
})
