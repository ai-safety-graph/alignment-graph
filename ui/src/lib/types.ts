export type NodeCompact = {
  id: number
  aid: string
  t: string
  au: string
  pd: string
  dm: string
  ln: string
  /** Taxonomy tags. Order carries no meaning -- no tag is more "primary" than another. */
  tags: string[]
  sm?: string
  x?: number
  y?: number
  rx?: number | null
  ry?: number | null
}

export type LinkCompact = { s: number; t: number; w: number }

export type TagsLegend = Record<
  string,
  { size: number; primary_size?: number }
>

export type GraphDataCompact = {
  meta: {
    model: string
    embedding_dim: number
    generated_at: string
    neighbors: { top_k: number; min_sim: number }
    coords: {
      included: boolean
      method: 'fa2' | 'fr' | 'umap' | 'pca' | 'stored' | 'stored-subset' | 'none'
      canvas: { w: number; h: number; pad: number }
      bounds?: {
        x_min: number
        x_max: number
        y_min: number
        y_max: number
      } | null
    }
    compact: boolean
  }
  tags: TagsLegend
  nodes: NodeCompact[]
  links: LinkCompact[]
}
