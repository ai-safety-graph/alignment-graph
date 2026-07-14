import type { ClustersLegend } from '../lib/types'

interface ClusterLabelProps {
  cid: number
  clusters: ClustersLegend
  isLoading: boolean
}

export default function ClusterLabel({
  cid,
  clusters,
  isLoading,
}: ClusterLabelProps) {
  if (isLoading) {
    return (
      <span
        className='inline-block h-3 w-16 rounded bg-neutral-800 align-middle animate-pulse'
        aria-hidden
      />
    )
  }
  return <>{clusters[String(cid)]?.label ?? `Cluster ${cid}`}</>
}
