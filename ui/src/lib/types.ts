export type NodeCompact = {
  id: number
  aid: string
  t: string
  au: string
  pd: string
  dm: string
  ln: string
  cid: number
  sm?: string
  x?: number
  y?: number
}

export type LinkCompact = { s: number; t: number; w: number }

export type ClustersLegend = Record<
  string,
  { label?: string | null; size: number }
>

export type GraphDataCompact = {
  meta: {
    model: string
    embedding_dim: number
    generated_at: string
    neighbors: { top_k: number; min_sim: number; same_cluster_only: boolean }
    coords: {
      included: boolean
      method: 'umap' | 'pca' | 'none'
      canvas: { w: number; h: number; pad: number }
    }
    compact: boolean
  }
  clusters: ClustersLegend
  nodes: NodeCompact[]
  links: LinkCompact[]
}
