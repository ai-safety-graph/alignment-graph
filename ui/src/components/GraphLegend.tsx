import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import {
  RELATED_GHOST_NODE_COLOR,
  SEARCH_GHOST_NODE_COLOR,
  SUBGRAPH_NODE_COLOR,
} from '../lib/graph'
import { getLegendCollapsed, setLegendCollapsed } from '../lib/storage'

const SWATCHES = [
  { color: SUBGRAPH_NODE_COLOR, label: 'Papers in this graph' },
  { color: SEARCH_GHOST_NODE_COLOR, label: 'Search results outside this graph' },
  { color: RELATED_GHOST_NODE_COLOR, label: 'Papers related to the selected one' },
]

// Explains the node colours and what position means. Starts expanded; a
// collapse is remembered across visits.
export default function GraphLegend() {
  const [collapsed, setCollapsed] = useState(getLegendCollapsed)

  const toggle = () => {
    setLegendCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }

  if (collapsed)
    return (
      <button
        type='button'
        onClick={toggle}
        aria-expanded={false}
        className='flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-neutral-950 border border-neutral-700 hover:border-neutral-500 text-[13px] text-neutral-300 hover:text-white transition-colors'
      >
        Legend
        <ChevronUp size={14} />
      </button>
    )

  return (
    <div className='w-[280px] bg-neutral-950 border border-[#333333] rounded-lg px-3 py-2.5 text-[12px] text-neutral-400'>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-[13px] font-medium text-neutral-300'>Legend</span>
        <button
          type='button'
          onClick={toggle}
          aria-expanded={true}
          aria-label='Collapse legend'
          className='p-0.5 rounded cursor-pointer text-neutral-400 hover:text-neutral-200'
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <ul className='space-y-1 mb-2'>
        {SWATCHES.map(({ color, label }) => (
          <li key={label} className='flex items-center gap-2 text-neutral-300'>
            <span
              className='shrink-0 w-2.5 h-2.5 rounded-full border border-white/70'
              style={{ backgroundColor: color }}
            />
            {label}
          </li>
        ))}
      </ul>
      <p className='leading-snug'>
        Papers are placed near others on similar topics, so closer means more
        alike. Use Filters to narrow by tag.
      </p>
    </div>
  )
}
