import type { LinkCompact, NodeCompact } from './types'

// Node radius in graph units, and the minimum centre-to-centre spacing the
// anchored layout's collide force separates nodes to (2 × radius plus a
// gap). The free layout (no stored coords) spaces nodes by its own, wider
// collide radius. Each node's pointer (hover/click) area is half the active
// layout's spacing, so neighbours' areas tile instead of covering each other.
export const NODE_RADIUS = 4
export const NODE_MIN_DIST = 2 * NODE_RADIUS + 4
export const FREE_COLLIDE_RADIUS = 13
export const nodeHitRadius = (anchored: boolean) =>
  anchored ? NODE_MIN_DIST / 2 : FREE_COLLIDE_RADIUS
// How close a paper's old spot may be to a neighbour for it to be frozen
// back there: the active spacing, less the slack settled neighbours sit
// within (the anchor pull slightly outweighs collide), so restored nodes'
// pointer areas overlap no more than settled ones' do.
export const restoreClearance = (anchored: boolean) =>
  2 * nodeHitRadius(anchored) - (NODE_MIN_DIST - 2 * NODE_RADIUS)

export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))
export const lc = (s?: string | null) => (s ?? '').toLowerCase()

// Node fills: papers in the loaded subgraph vs. ghost nodes surfaced as
// related papers or by search. Shared by the canvas and the legend.
export const SUBGRAPH_NODE_COLOR = '#6A93B0'
export const RELATED_GHOST_NODE_COLOR = '#F4A261'
export const SEARCH_GHOST_NODE_COLOR = '#8BD17C'
// Ring around papers added to a graph by hand
export const PINNED_RING_COLOR = '#4ea8de'

// Move an alpha linearly toward `target`, covering the full 0–1 range in
// `fadeMs`, so a node fading after `dt` ms never overshoots its target.
export function stepAlpha(
  current: number,
  target: number,
  dt: number,
  fadeMs: number,
) {
  const step = fadeMs > 0 ? dt / fadeMs : 1
  return current < target
    ? Math.min(target, current + step)
    : Math.max(target, current - step)
}

export function buildAdjacency(nodes: NodeCompact[], links: LinkCompact[]) {
  const byId = new Map<number, NodeCompact>()
  nodes.forEach((n) => byId.set(n.id, n))
  const adj = new Map<number, Array<{ id: number; w: number }>>()
  nodes.forEach((n) => adj.set(n.id, []))
  for (const { s, t, w } of links) {
    adj.get(s)!.push({ id: t, w })
    adj.get(t)!.push({ id: s, w })
  }
  for (const arr of adj.values()) arr.sort((a, b) => b.w - a.w)
  return { byId, adj }
}
