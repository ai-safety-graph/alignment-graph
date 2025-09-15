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
      ?.distance((l: any) => 20 + (1 - (l.w ?? 0)) * 120)
      .strength(0.3)
    fg.d3Force('charge', d3.forceManyBody().strength(-10))
    fg.d3Force(
      'collide',
      d3
        .forceCollide()
        .radius(() => 6)
        .iterations(2)
    )
  }, [fgRef, enabled])
}
