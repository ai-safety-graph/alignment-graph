import type { LinkCompact, NodeCompact } from './types'

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
