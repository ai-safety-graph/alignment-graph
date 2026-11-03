import { BadgeCheck } from 'lucide-react'

// Shown only for papers known to be peer-reviewed. Unknown status renders
// nothing, so it never reads as "not reviewed".
export default function VenueBadge({
  pr,
  vn,
}: {
  pr?: boolean
  vn?: string | null
}) {
  if (!pr) return null
  const label = vn || 'Peer-reviewed'
  return (
    <span
      title={vn ? `Peer-reviewed: ${vn}` : 'Peer-reviewed'}
      className='inline-flex min-w-0 max-w-full items-center gap-1 px-1.5 py-px rounded border border-neutral-600 text-[11px] leading-4 text-neutral-200'
    >
      <BadgeCheck size={11} className='shrink-0 text-[#4ea8de]' aria-hidden />
      <span className='truncate'>{label}</span>
    </span>
  )
}
