import { useEffect } from 'react'
import * as d3 from 'd3-force'
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d'
import type { LinkCompact, NodeCompact } from '../lib/types'

type GNode = NodeObject<NodeCompact>
// d3-force's own ForceLink requires source/target to already be resolved
// (never undefined) by the time the force runs; force-graph guarantees this
// internally, but LinkObject's type only tags them as optional.
type D3Link = LinkObject<NodeCompact, LinkCompact> & {
  source: string | number | GNode
  target: string | number | GNode
}

export function useForceConfig(
  fgRef: React.RefObject<ForceGraphMethods<NodeCompact, LinkCompact> | undefined>,
  enabled: boolean
) {
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !enabled) return
    const linkForce = fg.d3Force('link') as d3.ForceLink<GNode, D3Link> | undefined
    linkForce?.distance((l) => 74 + (1 - (l.w ?? 0)) * 222).strength(0.2)
    fg.d3Force('charge', d3.forceManyBody().strength(-147))
    fg.d3Force(
      'collide',
      d3
        .forceCollide()
        .radius(() => 13)
        .iterations(3)
    )
  }, [fgRef, enabled])
}
