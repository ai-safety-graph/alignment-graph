import { forceCollide, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationNodeDatum } from 'd3-force'
import type { LinkCompact, NodeCompact } from './types'

type Point = { x: number; y: number }

// Nudge `points` apart so no two sit closer than `minDist`, while pulling each
// back toward its original position so the (UMAP) layout's shape survives.
// `fixed` points are obstacles that never move (e.g. already-placed nodes
// when laying out ghosts). Runs a collide-only simulation to completion
// synchronously and returns the new positions, in input order.
export function separatePoints(
  points: Point[],
  { minDist, fixed = [] }: { minDist: number; fixed?: Point[] },
): Point[] {
  if (points.length === 0) return []
  type N = SimulationNodeDatum & { ax: number; ay: number }
  const movable: N[] = points.map((p) => ({ x: p.x, y: p.y, ax: p.x, ay: p.y }))
  const obstacles: N[] = fixed.map((p) => ({
    x: p.x, y: p.y, fx: p.x, fy: p.y, ax: p.x, ay: p.y,
  }))
  forceSimulation<N>([...movable, ...obstacles])
    .force('collide', forceCollide<N>(minDist / 2).iterations(4))
    .force('x', forceX<N>((n) => n.ax).strength(0.05))
    .force('y', forceY<N>((n) => n.ay).strength(0.05))
    .stop()
    .tick(200)
  return movable.map((n) => ({ x: n.x!, y: n.y! }))
}

export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))
export const lc = (s?: string | null) => (s ?? '').toLowerCase()

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
