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

    const add = screen.getByLabelText('Add to Mine')
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', 'Mine is full (500 papers)')
    await userEvent.click(add)
    expect(onAdd).not.toHaveBeenCalled()

    await userEvent.click(screen.getByLabelText('Remove from Mine'))
    expect(onRemove).toHaveBeenCalledWith('a')
  })
})
