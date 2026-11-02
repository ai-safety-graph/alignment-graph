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
  /** LLM classifier's one-line reason the paper counts as AI safety (single-paper endpoint only). */
  lr?: string
  x?: number
  y?: number
  rx?: number | null
  ry?: number | null
}

// Keyset cursor for /api/graph/range: the last row of the previous page.
export type GraphCursor = { before_date: string; before_id: string }

export type LinkCompact = { s: number; t: number; w: number }

export type TagsLegend = Record<
  string,
  { size: number; primary_size?: number; description?: string | null }
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
    // /api/graph/range only: full match count across every page, the
    // cursor for the next page (null on the last one), and this page's
    // published-date span (null when empty)
    total?: number
    next?: GraphCursor | null
    span?: { newest: string; oldest: string } | null
  }
  tags: TagsLegend
  nodes: NodeCompact[]
  links: LinkCompact[]
}
