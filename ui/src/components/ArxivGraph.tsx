import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from 'react-force-graph-2d'
import { Trash, Search } from 'lucide-react'

import { useForceConfig } from '../hooks/useForceConfig'
import { useGraphShortcuts } from '../hooks/useGraphShortcuts'
import { cidToColor } from '../lib/colors'
import { buildAdjacency, clamp, lc } from '../lib/graph'
import type {
  ClustersLegend,
  GraphDataCompact,
  LinkCompact,
  NodeCompact,
} from '../lib/types'

import PaperDetails from './PaperDetails'
import SearchResultsOverlay from './SearchResultsOverlay'
import ClusterLegendOverlay from './ClusterLegendOverlay'

export default function ArxivGraph({ src = '/graph.json' }: { src?: string }) {
  const fgRef = useRef<ForceGraphMethods | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [data, setData] = useState<GraphDataCompact | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [hoverId, setHoverId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lockedId, setLockedId] = useState<number | null>(null)
  const activeId = lockedId ?? hoverId

  const [query, setQuery] = useState('')
  const [width, setWidth] = useState<number>(0)
  const [height, setHeight] = useState<number>(0)

  // Layout measurements
  useLayoutEffect(() => {
    const measure = () => {
      setWidth(window.innerWidth)
      setHeight(window.innerHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  // Data fetch
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as GraphDataCompact
        if (!alive) return
        setData(json)
      } catch (e: any) {
        if (!alive) return
        setError(`Failed to load graph: ${e?.message ?? String(e)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [src])

  // Prepare simulation nodes (mutable x/y)
  const simNodes = useMemo(() => {
    if (!data) return [] as (NodeCompact & { x: number; y: number })[]
    return data.nodes.map((n) => ({ ...n, x: n.x ?? 0, y: n.y ?? 0 }))
  }, [data])

  const simById = useMemo(() => {
    const m = new Map<number, any>()
    for (const n of simNodes) m.set(n.id, n)
    return m
  }, [simNodes])

  const { byId, adj, clusters } = useMemo(() => {
    if (!data) {
      return {
        byId: new Map<number, NodeCompact>(),
        adj: new Map<number, Array<{ id: number; w: number }>>(),
        clusters: {} as ClustersLegend,
      }
    }
    const { byId, adj } = buildAdjacency(data.nodes, data.links)
    return { byId, adj, clusters: data.clusters }
  }, [data])

  // Search matching set (for dimming)
  const matchSet = useMemo(() => {
    const q = lc(query).trim()
    if (!q || !data) return null
    const s = new Set<number>()
    for (const n of data.nodes) {
      const hay = `${lc(n.t)}\n${lc(n.au)}\n${lc(n.dm)}\n${lc(n.sm)}`
      if (hay.includes(q)) s.add(n.id)
    }
    return s
  }, [query, data])

  // Scored search results
  const searchResults = useMemo(() => {
    if (!data) return []
    const q = lc(query).trim()
    if (!q) return []
    const terms = q.split(/\s+/).filter(Boolean)
    if (!terms.length) return []

    const weight = { title: 3, authors: 2, domain: 1.5, summary: 1 }
    const SEARCH_LIMIT = 100

    function termCount(hay: string, term: string) {
      let c = 0
      let i = 0
      while ((i = hay.indexOf(term, i)) !== -1) {
        c++
        i += term.length
      }
      return c
    }

    function scoreNode(n: NodeCompact) {
      const title = lc(n.t)
      const authors = lc(n.au)
      const domain = lc(n.dm)
      const summary = lc(n.sm)

      let base = 0
      for (const t of terms) {
        base += termCount(title, t) * weight.title
        base += termCount(authors, t) * weight.authors
        base += termCount(domain, t) * weight.domain
        base += termCount(summary, t) * weight.summary
      }

      const matched = base > 0
      const deg = adj.get(n.id)?.length ?? 0
      const score = matched ? base + Math.min(deg, 50) * 0.02 : 0
      return { n, score, deg }
    }

    return data.nodes
      .map(scoreNode)
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, SEARCH_LIMIT)
  }, [query, data, adj])

  const onSearchPick = (id: number) => {
    setSelectedId(id)
    setLockedId(id)
    focusNodeById(id)
  }

  // Neighbor highlight
  const neighborSet = useMemo(() => {
    if (activeId == null) return null
    const s = new Set<number>([activeId])
    for (const { id } of adj.get(activeId) ?? []) s.add(id)
    return s
  }, [activeId, adj])

  // Interaction gating
  const isInteractive = useCallback(
    (id: number) => {
      if (lockedId != null || selectedId != null) return !!neighborSet?.has(id)
      if (matchSet) return matchSet.has(id) || !!neighborSet?.has(id)
      return true
    },
    [lockedId, selectedId, matchSet, neighborSet]
  )

  // Selection + neighbors
  const selected = useMemo(
    () => (selectedId != null ? byId.get(selectedId) ?? null : null),
    [selectedId, byId]
  )
  const selectedNeighbors = useMemo(() => {
    if (selectedId == null) return []
    return (adj.get(selectedId) ?? [])
      .map(({ id, w }) => ({ n: byId.get(id)!, w }))
      .filter(({ n }) => !!n)
      .sort((a, b) => b.w - a.w)
  }, [selectedId, adj, byId])

  // Force configuration
  useForceConfig(fgRef, !!data)

  // Autofit once per src
  const didAutoFit = useRef(false)
  useEffect(() => {
    didAutoFit.current = false
  }, [src])
  useEffect(() => {
    const fg = fgRef.current as any
    if (!fg || !data || didAutoFit.current) return
    if (!width || !height) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          fg.zoomToFit(500, 250)
          didAutoFit.current = true
        } catch {}
      })
    })
  }, [data, width, height])

  // ESC unlock (global)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLockedId(null)
        setHoverId(null)
        setSelectedId(null)
        fgRef.current?.zoomToFit(400, 40)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Focus helpers
  function focusNode(simNode: any, zoomLevel = 1.1, duration = 600) {
    const fg = fgRef.current as any
    if (!fg || !simNode) return
    const x = simNode.x ?? 0
    const y = simNode.y ?? 0
    fg.centerAt(x, y, duration)
    const current = fg.zoom?.() ?? 1
    const target = Math.max(current, zoomLevel)
    fg.zoom(target, duration)
  }
  const focusNodeById = (id: number, zoomLevel = 1.1, duration = 600) => {
    const simNode = simById.get(id)
    focusNode(simNode, zoomLevel, duration)
  }

  // Node pinning
  function setPinned(n: any | null, pinned: boolean) {
    if (!n) return
    if (pinned) {
      n.fx = n.x
      n.fy = n.y
    } else {
      n.fx = undefined
      n.fy = undefined
    }
  }

  // Hover handling
  const hoverTimer = useRef<number | null>(null)
  const onNodeHover = (
    node: NodeObject | null,
    prevNode?: NodeObject | null
  ) => {
    if (node && !isInteractive((node as any).id)) {
      setPinned(prevNode as any, false)
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
      hoverTimer.current = window.setTimeout(() => setHoverId(null), 120)
      return
    }
    if (lockedId != null) return
    setPinned(prevNode as any, false)
    setPinned(node as any, true)
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    if (node) setHoverId((node as any).id)
    else hoverTimer.current = window.setTimeout(() => setHoverId(null), 120)
  }

  const onNodeClick = (node: NodeObject) => {
    const n = node as any
    if (!isInteractive(n.id)) return
    setSelectedId(n.id)
    setLockedId(n.id)
    setPinned(n, true)
    focusNode(n)
  }

  const onBackgroundClick = () => {
    if (hoverId != null) setPinned(simById.get(hoverId) as any, false)
    if (lockedId != null) setPinned(simById.get(lockedId) as any, false)
    fgRef.current?.zoomToFit(400, 40)
    setLockedId(null)
    setHoverId(null)
    setSelectedId(null)
  }

  // Keyboard shortcuts
  useGraphShortcuts({ query, setQuery, onBackgroundClick, searchInputRef })

  if (error) return <div className='text-red-600 p-4'>{error}</div>

  // Rendering helpers
  const nodeCanvasObject = (
    node: NodeObject,
    ctx: CanvasRenderingContext2D,
    globalScale: number
  ) => {
    const n = node as unknown as NodeCompact
    const r = 4
    ctx.save()
    let alpha = 1
    if (matchSet && !matchSet.has(n.id)) alpha = 0.15
    if (neighborSet) alpha = neighborSet.has(n.id) ? 1 : 0.08
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.fillStyle = cidToColor(n.cid)
    ctx.arc(n.x as number, n.y as number, r, 0, 2 * Math.PI, false)
    ctx.fill()
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.stroke()
    const drawLabel = neighborSet?.has(n.id) || selectedId === n.id
    if (drawLabel && globalScale > 0.8) {
      const label = n.t.length > 80 ? n.t.slice(0, 77) + '…' : n.t
      const fontSize = 10 / Math.sqrt(globalScale)
      ctx.globalAlpha = 1
      ctx.font = `${fontSize}px sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillText(label, (n.x as number) + 6, (n.y as number) + 3)
    }
    ctx.restore()
  }

  const linkColor = (link: LinkObject) => {
    const l = link as unknown as LinkCompact
    const alpha = clamp(0.15 + (l.w ?? 0) * 0.7, 0.15, 0.85)
    return `rgba(220,220,220,${alpha})`
  }

  const nodeLabel = (node: NodeObject) => `${(node as any).t}`

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5]'>
      {data && width > 0 && height > 0 && (
        <ForceGraph2D
          ref={fgRef as any}
          width={width}
          height={height}
          graphData={{
            nodes: simNodes as any[],
            links: (data.links as any[]) ?? [],
          }}
          backgroundColor='#1a1a1a'
          nodeId='id'
          linkSource='s'
          linkTarget='t'
          cooldownTicks={90}
          enableNodeDrag={false}
          nodeCanvasObject={nodeCanvasObject}
          nodeLabel={nodeLabel}
          linkColor={linkColor}
          nodePointerAreaPaint={(n: any, color, ctx) => {
            if (!isInteractive(n.id)) return
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(n.x, n.y, 10, 0, 2 * Math.PI)
            ctx.fill()
          }}
          linkVisibility={(l: any) => {
            if (activeId == null) return false
            const s =
              l.s ?? (typeof l.source === 'object' ? l.source?.id : l.source)
            const t =
              l.t ?? (typeof l.target === 'object' ? l.target?.id : l.target)
            return s === activeId || t === activeId
          }}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
          onBackgroundClick={onBackgroundClick}
        />
      )}

      {/* Search Bar */}
      <div className='fixed top-3 left-1/2 -translate-x-1/2 z-10 bg-[#2a2a2a] backdrop-blur-xs rounded-3xl w-[min(550px,80vw)] border border-[#333333]'>
        <div className='flex items-center gap-2'>
          <div className='relative flex-1'>
            <Search
              className='absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none'
              size={16}
            />
            <input
              ref={searchInputRef}
              placeholder='Search papers on AI safety & alignment'
              value={query}
              onChange={(e) => {
                if (selectedId != null) onBackgroundClick()
                setQuery(e.target.value)
              }}
              className='w-full pl-9 pr-20 py-2 rounded-3xl bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
            />
            <div className='absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-neutral-400 pointer-events-none select-none'>
              <kbd className='px-1.5 py-0.5 rounded bg-transparent border border-neutral-600 text-[11px] font-mono'>
                Ctrl
              </kbd>
              <kbd className='px-1.5 py-0.5 rounded bg-transparent border border-neutral-600 text-[11px] font-mono'>
                K
              </kbd>
            </div>
          </div>
          {query && (
            <button
              aria-label='Clear search query'
              onClick={() => setQuery('')}
              className='p-2 rounded-full cursor-pointer text-neutral-400 hover:text-neutral-200 flex items-center gap-2'
            >
              <Trash size={19} />
              <kbd className='px-1.5 py-0.5 rounded bg-transparent border border-neutral-600 text-[11px] font-mono'>
                Ctrl
              </kbd>
              <kbd className='px-1.5 py-0.5 rounded bg-transparent border border-neutral-600 text-[11px] font-mono'>
                Del
              </kbd>
            </button>
          )}
        </div>
      </div>

      {/* Overlays */}
      {query && searchResults.length > 0 && (
        <SearchResultsOverlay
          results={searchResults}
          onSelect={onSearchPick}
          clusters={clusters}
        />
      )}

      {selected && (
        <PaperDetails
          paper={selected}
          clusters={clusters}
          neighbors={selectedNeighbors}
          onClose={onBackgroundClick}
          onSelectPaper={(id) => {
            setSelectedId(id)
            setLockedId(id)
            focusNodeById(id)
          }}
        />
      )}

      <ClusterLegendOverlay clusters={clusters} />
    </div>
  )
}
