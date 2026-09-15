import { tagToColor } from '../lib/colors'
import type { TagsLegend } from '../lib/types'

export default function TagsLegendOverlay({
  tags,
}: {
  tags: TagsLegend
}) {
  if (!tags || Object.keys(tags).length === 0) return null

  return (
    <div className='bg-[#242424] backdrop-blur-md border border-[#333333] rounded-xl p-3 w-[360px] max-h-[40vh] overflow-auto text-neutral-200'>
      <h4 className='m-0 mb-2 font-semibold text-sm text-[#e5e5e5]'>
        Tags
      </h4>
      <div className='grid grid-cols-2 gap-2'>
        {Object.entries(tags).map(([tag, info]) => {
          const color = tagToColor(tag)
          return (
            <div
              key={tag}
              className='flex items-center gap-2 rounded-full px-2 py-1 text-[13px] truncate bg-neutral-700'
              title={tag}
            >
              <div
                className='w-3 h-3 rounded-full border border-[#333333] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                style={{ background: color }}
              />
              <span className='truncate flex-1 text-neutral-200'>
                {tag}
              </span>
              <span className='text-neutral-400'>{info.size}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
