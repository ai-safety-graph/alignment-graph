import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import SharePlusIcon from './icons/SharePlusIcon'
import ShareMinusIcon from './icons/ShareMinusIcon'
import type { NodeCompact, ClustersLegend } from '../lib/types'
import { cidToColor } from '../lib/colors'
import { domainLabel } from '../lib/domain'
import ClusterLabel from './ClusterLabel'

interface PaperListProps {
  items: Array<{ n: NodeCompact }>
  clusters: ClustersLegend
  clustersLoading?: boolean
  onSelectId: (aid: string) => void
  enableHover?: boolean
  resetKey?: string
  hasMore?: boolean
  onLoadMore?: () => void
  selectedId?: string
  onAddToSubgraph?: (aid: string) => void
  onRemoveFromSubgraph?: (aid: string) => void
  subgraphPaperIds?: Set<string>
  subgraphName?: string
}

export default function PaperList({
  items,
  clusters,
  clustersLoading = false,
  onSelectId,
  enableHover = false,
  resetKey,
  hasMore = false,
  onLoadMore,
  selectedId,
  onAddToSubgraph,
  onRemoveFromSubgraph,
  subgraphPaperIds,
  subgraphName,
}: PaperListProps) {
  const [limit, setLimit] = useState(40)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const slice = useMemo(() => items.slice(0, limit), [items, limit])

  useLayoutEffect(() => {
    onLoadMoreRef.current = onLoadMore
  })

  // Reset to top when resetKey changes (or items reference when no resetKey is provided)
  const effectiveResetKey = resetKey ?? items
  useEffect(() => {
    setLimit(40)
  }, [effectiveResetKey])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return
      if (limit < items.length) {
        setLimit((l) => Math.min(l + 40, items.length))
      } else if (hasMore) {
        onLoadMoreRef.current?.()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [items.length, limit, hasMore])

  return (
    <>
      <ul>
        {slice.map(({ n }) => {
          const inSubgraph = subgraphPaperIds?.has(n.aid) ?? false
          return (
          <li key={n.aid} className='relative group/row mb-1.5 last:mb-0'>
            <button
              onClick={() => onSelectId(n.aid)}
              className={`w-full text-left px-4 py-3 pr-10 rounded-md cursor-pointer active:bg-[#2a2a2a]${n.aid === selectedId ? ' bg-neutral-800' : ''}${enableHover ? ' group-hover/row:bg-[#2a2a2a]' : ''}`}
            >
              <div className='text-[13px] text-neutral-400 truncate'>
                {n.au}
              </div>
              <div className='mt-0.5 text-[15px] leading-snug'>{n.t}</div>
              <div className='mt-1 text-[12px] text-neutral-400'>
                <div className='flex items-center gap-2 mb-0.5'>
                  <span
                    className='inline-block w-2 h-2 rounded-full border border-[#333333]'
                    style={{ background: cidToColor(n.cid) }}
                    aria-hidden
                  />
                  <span>
                    <ClusterLabel
                      cid={n.cid}
                      clusters={clusters}
                      isLoading={clustersLoading}
                    />
                  </span>
                  <span>•</span>
                  <span>{domainLabel(n.dm)}</span>
                </div>
              </div>
            </button>
            {(onAddToSubgraph || onRemoveFromSubgraph) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (inSubgraph) onRemoveFromSubgraph?.(n.aid)
                  else onAddToSubgraph?.(n.aid)
                }}
                aria-label={
                  inSubgraph
                    ? `Remove from ${subgraphName ?? 'subgraph'}`
                    : `Add to ${subgraphName ?? 'subgraph'}`
                }
                className='group absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200'
              >
                {inSubgraph ? <ShareMinusIcon size={14} className='text-red-800 group-hover:text-red-500 transition-colors' /> : <SharePlusIcon size={14} className='text-green-800 group-hover:text-green-500 transition-colors' />}
              </button>
            )}
          </li>
          )
        })}
      </ul>
      <div ref={sentinelRef} className='h-10' />
    </>
  )
}
