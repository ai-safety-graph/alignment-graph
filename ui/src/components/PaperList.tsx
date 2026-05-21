import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NodeCompact, ClustersLegend } from '../lib/types'
import { cidToColor } from '../lib/colors'

interface PaperListProps {
  items: Array<{ n: NodeCompact; deg: number }>
  clusters: ClustersLegend
  onSelectId: (id: number) => void
  enableHover?: boolean
  resetKey?: string
  hasMore?: boolean
  onLoadMore?: () => void
}

export default function PaperList({
  items,
  clusters,
  onSelectId,
  enableHover = false,
  resetKey,
  hasMore = false,
  onLoadMore,
}: PaperListProps) {
  const [limit, setLimit] = useState(40)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const slice = useMemo(() => items.slice(0, limit), [items, limit])

  useLayoutEffect(() => { onLoadMoreRef.current = onLoadMore })

  // Reset to top when resetKey changes (or items reference when no resetKey is provided)
  const effectiveResetKey = resetKey ?? items
  useEffect(() => {
    setLimit(40)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <ul className='divide-y divide-neutral-800'>
        {slice.map(({ n, deg }) => (
          <li key={n.id}>
            <button
              onClick={() => onSelectId(n.id)}
              className={`w-full text-left px-4 py-3 active:bg-neutral-900${enableHover ? ' hover:bg-neutral-900' : ''}`}
            >
              <div className='text-[13px] text-neutral-400 truncate'>{n.au}</div>
              <div className='mt-0.5 text-[15px] leading-snug'>{n.t}</div>
              <div className='mt-1 text-[12px] text-neutral-400'>
                <div className='flex items-center gap-2 mb-0.5'>
                  <span
                    className='inline-block w-2 h-2 rounded-full border border-[#333333]'
                    style={{ background: cidToColor(n.cid) }}
                    aria-hidden
                  />
                  <span>{clusters[String(n.cid)]?.label ?? `Cluster ${n.cid}`}</span>
                  <span>•</span>
                  <span>{n.dm}</span>
                  <span>•</span>
                  <span>{deg} related</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div ref={sentinelRef} className='h-10' />
    </>
  )
}
