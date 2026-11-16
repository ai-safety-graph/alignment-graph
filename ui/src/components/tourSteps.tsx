import type { ReactNode } from 'react'

// The graph tour's steps, in order. Targets are `data-tour` attributes in
// GraphView and HeaderNav; a missing one falls back to a centred card.
const KBD =
  'px-1 py-px rounded border border-neutral-600 text-[11px] font-mono text-neutral-300'

export type TourStep = {
  // `data-tour` value of the element to point at; null centres the card
  target: string | null
  title: string
  body: ReactNode
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to Alignment Graph',
    body: (
      <>
        A map of AI safety and alignment research on arXiv. Each dot is a paper,
        and papers on similar topics sit close together.
      </>
    ),
  },
  {
    target: 'graph-picker',
    title: 'Choose what’s shown',
    body: (
      <>
        <span className='text-white'>New graph</span> picks topic tags, research
        domains and a date range. Saved graphs live here too, so you can switch
        between them.
      </>
    ),
  },
  {
    target: 'search',
    title: 'Search',
    body: (
      <>
        Search papers by keyword. Press <kbd className={KBD}>/</kbd> or{' '}
        <kbd className={KBD}>Ctrl</kbd>+<kbd className={KBD}>K</kbd> to search
        and <kbd className={KBD}>Esc</kbd> to clear. Matches outside this graph
        show up in green.
      </>
    ),
  },
  {
    target: 'legend',
    title: 'Reading the map',
    body: (
      <>
        Only closeness matters; the axes mean nothing. Click a dot for its
        summary and related papers (orange), and{' '}
        <span className='text-white'>Pin</span> the ones you want to keep in a
        saved graph.
      </>
    ),
  },
  {
    target: 'view-switch',
    title: 'List view',
    body: (
      <>
        The same papers as a searchable list. You can reopen this tour any time
        with the <span className='text-white'>?</span> button at the top right.
      </>
    ),
  },
]
