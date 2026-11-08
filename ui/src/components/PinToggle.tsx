import type { MouseEvent } from 'react'
import { Pin } from 'lucide-react'
import { PINNED_RING_COLOR } from '../lib/graph'
import { MAX_PINNED } from '../lib/storage'

interface Props {
  pinned: boolean
  // At MAX_PINNED: pinning is disabled (unpinning never is)
  full?: boolean
  graphName?: string
  onPin?: () => void
  onUnpin?: () => void
  // 'button' is the panel's main toggle; 'icon' is the per-row related-list toggle
  variant?: 'button' | 'icon'
  // Icon variant only: spacing for the host list (default 'self-start p-1')
  className?: string
}

// Shows state ("Pinned"), not the action, like Star/Starred. The graph name is
// shown once in the picker, so here it lives only in the tooltip/aria-label.
export default function PinToggle({
  pinned,
  full,
  graphName,
  onPin,
  onUnpin,
  variant = 'button',
  className = 'self-start p-1',
}: Props) {
  const label = graphName ?? 'Subgraph'
  const disabled = !pinned && !!full
  const action = pinned ? `Unpin from ${label}` : `Pin to ${label}`
  const title = disabled
    ? `${label} already has ${MAX_PINNED} pinned papers`
    : action
  const color = pinned ? PINNED_RING_COLOR : undefined
  const icon = (
    <Pin
      size={14}
      className='shrink-0'
      style={{ color }}
      fill={pinned ? 'currentColor' : 'none'}
    />
  )
  const onClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (pinned) onUnpin?.()
    else onPin?.()
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={action}
        aria-pressed={pinned}
        className={`shrink-0 ${className} rounded-full cursor-pointer text-neutral-500 hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-neutral-500`}
      >
        {icon}
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={action}
      aria-pressed={pinned}
      className='group shrink-0 flex items-center gap-1.5 text-[13px] text-neutral-300 hover:text-white bg-neutral-950 border border-neutral-700 hover:border-neutral-500 rounded-md px-2.5 py-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-neutral-300 disabled:hover:border-neutral-700'
    >
      {icon}
      {pinned ? (
        // Both labels share one grid cell so the width doesn't jump on hover
        <span className='grid'>
          <span className='col-start-1 row-start-1 group-hover:invisible group-focus-visible:invisible'>
            Pinned
          </span>
          <span className='col-start-1 row-start-1 invisible group-hover:visible group-focus-visible:visible'>
            Unpin
          </span>
        </span>
      ) : (
        <span>Pin</span>
      )}
    </button>
  )
}
