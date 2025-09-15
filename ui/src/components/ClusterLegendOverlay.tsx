import { cidToColor } from '../lib/colors'
import type { ClustersLegend } from '../lib/types'

export default function ClusterLegendOverlay({
  clusters,
}: {
  clusters: ClustersLegend
}) {
  if (!clusters || Object.keys(clusters).length === 0) return null

  return (
    <div className='fixed left-4 bottom-4 z-10 bg-[#242424] backdrop-blur-md border border-[#333333] rounded-xl p-3 w-[360px] max-h-[40vh] overflow-auto text-neutral-200'>
      <h4 className='m-0 mb-2 font-semibold text-sm text-[#e5e5e5]'>
        Clusters
      </h4>
      <div className='grid grid-cols-2 gap-2'>
        {Object.entries(clusters).map(([cidStr, info]) => {
          const cid = parseInt(cidStr, 10)
          const color = cidToColor(cid)
          return (
            <div
              key={cidStr}
              className='flex items-center gap-2 rounded-full px-2 py-1 text-[13px] truncate bg-neutral-700'
              title={info.label ?? `Cluster ${cid}`}
            >
              <div
                className='w-3 h-3 rounded-full border border-[#333333] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                style={{ background: color }}
              />
              <span className='truncate flex-1 text-neutral-200'>
                {info.label ?? `Cluster ${cid}`}
              </span>
              <span className='text-neutral-400'>{info.size}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
