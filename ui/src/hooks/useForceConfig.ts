import { useEffect } from 'react'
import * as d3 from 'd3-force'
import type { ForceGraphMethods } from 'react-force-graph-2d'

export function useForceConfig(
  fgRef: React.RefObject<ForceGraphMethods | null>,
  enabled: boolean
) {
  useEffect(() => {
    const fg = fgRef.current as any
    if (!fg || !enabled) return
    fg.d3Force('link')
      ?.distance((l: any) => 74 + (1 - (l.w ?? 0)) * 222)
      .strength(0.2)
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
