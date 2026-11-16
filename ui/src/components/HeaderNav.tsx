import type { MouseEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { List, Share2 } from 'lucide-react'

type View = 'graph' | 'list'

const VIEWS: { view: View; to: string; label: string; Icon: typeof List }[] = [
  { view: 'graph', to: '/', label: 'Graph', Icon: Share2 },
  { view: 'list', to: '/browse', label: 'List', Icon: List },
]

type Props = {
  current: View
  /** Click handler for links that leave the current view, e.g. to confirm
      dropping an unsaved draft first. */
  onLeave?: MouseEventHandler
}

// Desktop header, shared by the graph and list views: the logo (home) sits
// at the left edge, followed by the graph picker and then the view switch.
// Both views lay these out in a `gap-2` row; the logo carries a little extra
// room after it, and the picker's width cap is shared so the view switch
// lands in the same place whichever view is showing.
export const GRAPH_PICKER_WIDTH = 'max-w-[140px] lg:max-w-[240px]'

export function HeaderLogo({ current, onLeave }: Props) {
  return (
    <Link
      to='/'
      aria-label='Alignment Graph home'
      onClick={current === 'graph' ? undefined : onLeave}
      className='shrink-0 md:mr-1'
    >
      <img
        src='/ag-logo.svg'
        alt='Alignment Graph'
        className='h-[30px] w-auto opacity-60 saturate-70 hover:opacity-90 transition-opacity'
      />
    </Link>
  )
}

export function ViewSwitch({ current, onLeave }: Props) {
  return (
    <nav
      aria-label='View'
      className='shrink-0 flex items-center p-0.5 rounded-md bg-neutral-950 text-[13px]'
    >
      {VIEWS.map(({ view, to, label, Icon }) =>
        view === current ? (
          <span
            key={view}
            aria-current='page'
            className='flex items-center gap-1.5 px-2 py-0.5 rounded bg-neutral-800 text-white'
          >
            <Icon size={13} />
            {label}
          </span>
        ) : (
          <Link
            key={view}
            to={to}
            onClick={onLeave}
            className='flex items-center gap-1.5 px-2 py-0.5 rounded text-neutral-400 hover:text-white transition-colors'
          >
            <Icon size={13} />
            {label}
          </Link>
        ),
      )}
    </nav>
  )
}
