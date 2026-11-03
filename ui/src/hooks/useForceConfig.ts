import { useEffect } from 'react'
import * as d3 from 'd3-force'
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d'
import { FREE_COLLIDE_RADIUS, NODE_MIN_DIST } from '../lib/graph'
import type { LinkCompact, NodeCompact } from '../lib/types'

// Simulation nodes carry an anchor (ax, ay): the stored layout coord they're
// pulled back toward in anchored mode.
type GNode = NodeObject<NodeCompact> & { ax?: number; ay?: number }
// d3-force's own ForceLink requires source/target to already be resolved
// (never undefined) by the time the force runs; force-graph guarantees this
// internally, but LinkObject's type only tags them as optional.
type D3Link = LinkObject<NodeCompact, LinkCompact> & {
  source: string | number | GNode
  target: string | number | GNode
}

// Anchored: the graph has stored (UMAP) coords. Graph responses carry no
// links, so charge/center would only scatter the topic map into a blob;
// instead collide separates overlapping nodes while weak x/y forces pull each
// back toward its stored position. Free: no coords, so lay out from scratch.
const ANCHOR_STRENGTH = 0.05

export function useForceConfig(
  fgRef: React.RefObject<ForceGraphMethods<NodeCompact, LinkCompact> | undefined>,
  enabled: boolean,
  anchored: boolean,
) {
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !enabled) return
    if (anchored) {
      fg.d3Force('charge', null)
      fg.d3Force('center', null)
      fg.d3Force(
        'collide',
        d3.forceCollide<GNode>(NODE_MIN_DIST / 2).iterations(4),
      )
      fg.d3Force(
        'x',
        d3.forceX<GNode>((n) => n.ax ?? n.x ?? 0).strength(ANCHOR_STRENGTH),
      )
      fg.d3Force(
        'y',
        d3.forceY<GNode>((n) => n.ay ?? n.y ?? 0).strength(ANCHOR_STRENGTH),
      )
      return
    }
    const linkForce = fg.d3Force('link') as d3.ForceLink<GNode, D3Link> | undefined
    linkForce?.distance((l) => 74 + (1 - (l.w ?? 0)) * 222).strength(0.2)
    fg.d3Force('charge', d3.forceManyBody().strength(-147))
    fg.d3Force('center', d3.forceCenter())
    fg.d3Force(
      'collide',
      d3
        .forceCollide()
        .radius(() => FREE_COLLIDE_RADIUS)
        .iterations(3)
    )
    fg.d3Force('x', null)
    fg.d3Force('y', null)
  }, [fgRef, enabled, anchored])
}
