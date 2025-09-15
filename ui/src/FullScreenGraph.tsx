import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useCallback,
} from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from 'react-force-graph-2d'
import * as d3 from 'd3-force'
import { CircleX, Trash } from 'lucide-react'

// ---------- Types ----------
type NodeCompact = {
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
type LinkCompact = { s: number; t: number; w: number }
type ClustersLegend = Record<string, { label?: string | null; size: number }>
type GraphDataCompact = {
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

// ---------- Helpers ----------
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))

function cidToColor(cid: number): string {
  const hue = (cid * 137.508) % 360
  return `hsl(${hue}, 65%, 55%)`
}

function buildAdjacency(nodes: NodeCompact[], links: LinkCompact[]) {
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

const lc = (s?: string | null) => (s ?? '').toLowerCase()

function SearchResultsOverlay({
  results,
  onSelect,
  clusters,
}: {
  results: Array<{ n: NodeCompact; score: number; deg: number }>
  onSelect: (id: number) => void
  clusters: ClustersLegend
}) {
  if (!results?.length) return null

  return (
    <aside
      className='scrollbar scrollbar-thin
             scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent
             scrollbar-hover:scrollbar-thumb-[#666]
             fixed top-[72px] left-4 bottom-[208px] w-[360px] z-10
             bg-[#262626] backdrop-blur-md border border-[#333333]
             rounded-xl p-3 overflow-auto text-[#e5e5e5]'
    >
      <div className='flex items-center mb-2'>
        <h3 className='m-0 flex-1 text-base font-semibold text-[#f5f5f5]'>
          Search Results
        </h3>
        <span className='text-[12px] text-neutral-400'>{results.length}</span>
      </div>

      <ul className='list-none p-0 m-0'>
        {results.map(({ n /* , score, deg */ }) => (
          <li key={n.id} className='py-2 border-b border-neutral-800'>
            <div className='flex items-start gap-2'>
              <div className='flex-1 min-w-0'>
                <a
                  href='#'
                  onClick={(e) => {
                    e.preventDefault()
                    onSelect(n.id)
                  }}
                  className='no-underline text-blue-400 hover:underline block'
                  title={n.t}
                >
                  {n.t.length > 90 ? n.t.slice(0, 87) + '…' : n.t}
                </a>
                <div className='text-[12px] text-neutral-500 truncate'>
                  {n.au}
                </div>
                <div className='text-[12px] text-neutral-400 flex items-center gap-2 mb-0.5'>
                  <span
                    className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                    style={{ background: cidToColor(n.cid) }}
                    aria-hidden
                  />
                  <span>
                    {clusters[String(n.cid)]?.label ?? `Cluster ${n.cid}`} •{' '}
                    {n.dm}
                  </span>
                </div>
              </div>
              {/* <div className='text-right pl-2 shrink-0'>
                <div className='text-[12px] text-neutral-300 tabular-nums'>
                  {score.toFixed(2)}
                </div>
                <div className='text-[11px] text-neutral-500'>deg {deg}</div>
              </div> */}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

// ---------- Cluster Legend Overlay ----------
function ClusterLegendOverlay({ clusters }: { clusters: ClustersLegend }) {
  if (!clusters || Object.keys(clusters).length === 0) return null

  return (
    <div className='fixed left-4 bottom-4 z-10 bg-[#242424] backdrop-blur-md border  border-[#333333] rounded-xl p-3 w-[360px] max-h-[40vh] overflow-auto text-neutral-200'>
      <h4 className='m-0 mb-2 font-semibold text-sm text-[#e5e5e5]'>
        Clusters
      </h4>
      <div className='grid grid-cols-2 gap-2'>
        {Object.entries(clusters).map(([cidStr, info]) => {
          const cid = parseInt(cidStr, 10)
          const color = cidToColor(cid)
          return (
            <div
              key={cidStr}
              className='flex items-center gap-2 rounded-full px-2 py-1 text-[13px] truncate bg-neutral-700'
              title={info.label ?? `Cluster ${cid}`}
            >
              <div
                className='w-3 h-3 rounded-full border  border-[#333333] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                style={{ background: color }}
              />
              <span className='truncate flex-1 text-neutral-200'>
                {info.label ?? `Cluster ${cid}`}
              </span>
              <span className='text-neutral-400'>{info.size}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Component ----------
export default function ArxivGraphFullscreen({
  src = '/graph2.json',
}: {
  src?: string
}) {
  const fgRef = useRef<ForceGraphMethods | null>(null)

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [data, setData] = useState<GraphDataCompact | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [hoverId, setHoverId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lockedId, setLockedId] = useState<number | null>(null)
  const activeId = lockedId ?? hoverId

  const [query, setQuery] = useState('')

  // Fullscreen canvas size
  const [width, setWidth] = useState<number>(0)
  const [height, setHeight] = useState<number>(0)

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

  // fetch graph
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

  // The simulation nodes we pass to the graph (mutable, with live x/y)
  const simNodes = useMemo(() => {
    if (!data) return [] as (NodeCompact & { x: number; y: number })[]
    return data.nodes.map((n) => ({ ...n, x: n.x ?? 0, y: n.y ?? 0 }))
  }, [data])

  // Fast lookup of the **simulation** node objects by id (for live coords)
  const simById = useMemo(() => {
    const m = new Map<number, any>()
    for (const n of simNodes) m.set(n.id, n)
    return m
  }, [simNodes])

  // adjacency + labels from the immutable data
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

  // search: build match set (dim non-matches)
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

  // simple weighted scoring for search results
  const searchResults = useMemo(() => {
    if (!data) return []
    const q = lc(query).trim()
    if (!q) return []

    const terms = q.split(/\s+/).filter(Boolean)
    if (!terms.length) return []

    const weight = { title: 3, authors: 2, domain: 1.5, summary: 1 }
    const SEARCH_LIMIT = 100 // adjust to taste

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
      // only apply tie-breaker if we had a real text match
      const score = matched ? base + Math.min(deg, 50) * 0.02 : 0

      return { n, score, deg }
    }

    const scored = data.nodes
      .map(scoreNode)
      .filter((r) => r.score > 0) // exclude non-matches
      .sort((a, b) => b.score - a.score)

    return scored.slice(0, SEARCH_LIMIT)
  }, [query, data, adj])

  const onSearchPick = useCallback(
    (id: number) => {
      setSelectedId(id)
      setLockedId(id)
      focusNodeById(id)
    },
    [focusNodeById]
  )

  // neighbor highlight set (hover OR locked)
  const neighborSet = useMemo(() => {
    if (activeId == null) return null
    const s = new Set<number>([activeId])
    for (const { id } of adj.get(activeId) ?? []) s.add(id)
    return s
  }, [activeId, adj])

  // allow interaction based on state:
  // - when a node is selected/locked: ONLY that node + its neighbors
  // - when searching (no selection): matches OR neighbors of the active (hover) node
  // - otherwise: all nodes
  const isInteractive = useCallback(
    (id: number) => {
      // If a node is selected (locked), restrict to its neighborhood
      if (lockedId != null || selectedId != null) {
        return !!neighborSet?.has(id)
      }

      // If searching but nothing is selected, allow matches + neighbor highlight
      if (matchSet) {
        if (matchSet.has(id)) return true
        if (neighborSet?.has(id)) return true
        return false
      }

      // No selection and no search: everything is interactive
      return true
    },
    [lockedId, selectedId, matchSet, neighborSet]
  )

  // selection & neighbors (sorted by similarity)
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

  // forces
  useEffect(() => {
    const fg = fgRef.current as any
    if (!fg || !data) return
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
  }, [data])

  // auto-fit once
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

  function isTypingInField(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    if (!el) return false
    const tag = (el.tagName || '').toLowerCase()
    const editable = (el as HTMLElement).isContentEditable
    return tag === 'input' || tag === 'textarea' || editable
  }

  // ESC unlock
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLockedId(null)
        setHoverId(null)
        setSelectedId(null) // 👈 ensure details panel hides
        fgRef.current?.zoomToFit(400, 40)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ---- NEW: gentle center+zoom helpers ----
  function focusNode(simNode: any, zoomLevel = 1.5, duration = 600) {
    const fg = fgRef.current as any
    if (!fg || !simNode) return
    const x = simNode.x ?? 0
    const y = simNode.y ?? 0
    fg.centerAt(x, y, duration)
    // "Slight" zoom-in: bump to a modest level (don’t over-zoom)
    const current = fg.zoom?.() ?? 1
    const target = Math.max(current, zoomLevel)
    fg.zoom(target, duration)
  }

  function focusNodeById(id: number, zoomLevel = 1.5, duration = 600) {
    const simNode = simById.get(id)
    focusNode(simNode, zoomLevel, duration)
  }
  // ----------------------------------------

  // draw nodes with coloring + dimming
  const nodeCanvasObject = (
    node: NodeObject,
    ctx: CanvasRenderingContext2D,
    globalScale: number
  ) => {
    const n = node as unknown as NodeCompact
    const r = 4

    ctx.save() // <-- prevent style leakage

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
      ctx.globalAlpha = 1 // make labels crisp
      ctx.font = `${fontSize}px sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.9)' // dark theme
      ctx.fillText(label, (n.x as number) + 6, (n.y as number) + 3)
    }

    ctx.restore() // <-- reset alpha, fill/stroke, etc.
  }

  const linkColor = (link: LinkObject) => {
    const l = link as unknown as LinkCompact
    const alpha = clamp(0.15 + (l.w ?? 0) * 0.7, 0.15, 0.85)
    return `rgba(220,220,220,${alpha})` // light gray for dark bg
  }

  const nodeLabel = (node: NodeObject) => {
    const n = node as unknown as NodeCompact
    return `${n.t}`
  }

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

  const hoverTimer = useRef<number | null>(null)
  const onNodeHover = (
    node: NodeObject | null,
    prevNode?: NodeObject | null
  ) => {
    if (node && !isInteractive((node as any).id)) {
      setPinned(prevNode as any, false)
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
      hoverTimer.current = window.setTimeout(() => {
        setHoverId(null)
      }, 120)
      return
    }

    if (lockedId != null) return
    setPinned(prevNode as any, false)
    setPinned(node as any, true)
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    if (node) {
      setHoverId((node as any).id)
    } else {
      hoverTimer.current = window.setTimeout(() => {
        setHoverId(null)
      }, 120)
    }
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
    if (hoverId != null) {
      const n = simById.get(hoverId) as any
      if (n) setPinned(n, false)
    }
    if (lockedId != null) {
      const n = simById.get(lockedId) as any
      if (n) setPinned(n, false)
    }
    fgRef.current?.zoomToFit(400, 40)
    setLockedId(null)
    setHoverId(null)
    setSelectedId(null) // 👈 ensure details panel hides
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingInField(e)

      // Focus search: Cmd/Ctrl+K or "/"
      if (
        (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) ||
        (e.key === '/' && !e.metaKey && !e.ctrlKey && !typing)
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select?.()
        return
      }

      // Clear search: Cmd/Ctrl+Backspace anywhere
      if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault()
        if (query) {
          setQuery('')
          onBackgroundClick()
        }
        return
      }

      // Clear search: Esc when search box is focused
      if (
        e.key === 'Escape' &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault()
        if (query) {
          setQuery('')
          onBackgroundClick()
        } else {
          ;(document.activeElement as HTMLElement)?.blur?.()
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, onBackgroundClick])

  if (error) return <div className='text-red-600 p-4'>{error}</div>

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
          cooldownTicks={75}
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
          // linkDirectionalParticles={(l: any) => {
          //   if (activeId == null) return 0
          //   const s =
          //     l.s ?? (typeof l.source === 'object' ? l.source?.id : l.source)
          //   const t =
          //     l.t ?? (typeof l.target === 'object' ? l.target?.id : l.target)
          //   return s === activeId || t === activeId ? 2 : 0
          // }}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
          onBackgroundClick={onBackgroundClick}
        />
      )}

      {/* Floating Search Bar (top-center) */}
      <div className='fixed top-3 left-1/2 -translate-x-1/2 z-10 bg-[#2a2a2a] backdrop-blur-xs rounded-3xl w-[min(550px,80vw)] border border-[#333333]'>
        <div className='flex items-center'>
          <div className='relative flex-1'>
            <input
              ref={searchInputRef}
              placeholder='Search papers'
              value={query}
              onChange={(e) => {
                if (selectedId != null) onBackgroundClick()
                setQuery(e.target.value)
              }}
              className='w-full px-3 py-2 pr-16 rounded-3xl bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
            />
            {/* Shortcut hint */}
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

      {/* Floating Search Results (right-left column) */}
      {query && searchResults.length > 0 && (
        <SearchResultsOverlay
          results={searchResults}
          onSelect={onSearchPick}
          clusters={clusters}
        />
      )}

      {/* Floating Details Panel (right) */}
      {selected && (
        <aside
          className='fixed top-[72px] right-4 bottom-4 w-[360px] z-10 bg-[#262626] backdrop-blur-md border border-[#333333] rounded-xl p-3 overflow-auto text-[#e5e5e5] scrollbar scrollbar-thin
             scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent
             scrollbar-hover:scrollbar-thumb-[#666]'
        >
          <div>
            <div className='flex items-center justify-between mb-2'>
              <div className='flex items-center gap-2 mb-0.5'>
                <span
                  className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                  style={{ background: cidToColor(selected.cid) }}
                  aria-hidden
                />
                <span className='text-[13px] text-neutral-400'>
                  {clusters[String(selected.cid)]?.label ??
                    `Cluster ${selected.cid}`}{' '}
                  • {selected.dm}
                </span>
              </div>
              <div className='flex items-center gap-1'>
                <kbd className='px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-600 text-[10px] font-mono text-neutral-300'>
                  Esc
                </kbd>
                <button
                  onClick={onBackgroundClick}
                  className='p-1.5 rounded-full hover:bg-neutral-700 cursor-pointer text-neutral-400 hover:text-neutral-200'
                >
                  <CircleX size={20} />
                </button>
              </div>
            </div>
            <h4 className='mt-1 mb-2 text-lg font-semibold leading-snug text-[#e5e5e5]'>
              {selected.t}
            </h4>
            <div className='text-[13px] mb-1.5'>
              <strong>Authors:</strong> {selected.au}
            </div>
            <div className='text-[13px] mb-1.5'>
              <strong>Published:</strong> {selected.pd || '—'}
            </div>
            <div className='flex gap-2 mb-3'>
              <a
                href={selected.ln}
                target='_blank'
                rel='noreferrer'
                className='text-[13px] text-[#4ea8de] hover:text-[#60a5fa] hover:underline'
              >
                arXiv link ↗
              </a>
            </div>

            {selected.sm && (
              <>
                <div className='font-semibold my-2 text-neutral-200'>
                  Summary
                </div>
                <p className='whitespace-pre-wrap leading-relaxed text-neutral-300'>
                  {selected.sm}
                </p>
              </>
            )}

            <div className='font-semibold my-2 text-neutral-200'>
              Aligned Papers
            </div>
            <div className='text-[13px] text-neutral-400 mb-1.5'>
              Showing {selectedNeighbors.length} (sorted by similarity)
            </div>
            <ul className='list-none p-0 m-0'>
              {selectedNeighbors.map(({ n, w }) => (
                <li key={n.id} className='py-1.5 border-b border-neutral-800'>
                  <div className='flex justify-between gap-2'>
                    <a
                      onClick={(e) => {
                        e.preventDefault()
                        setSelectedId(n.id)
                        setLockedId(n.id)
                        focusNodeById(n.id)
                      }}
                      href='#'
                      className='no-underline text-blue-400 hover:underline flex-1'
                      title={n.t}
                    >
                      {n.t.length > 80 ? n.t.slice(0, 77) + '…' : n.t}
                    </a>
                    <span className='text-neutral-300 tabular-nums'>
                      {w.toFixed(3)}
                    </span>
                  </div>

                  <div className='text-[12px] text-neutral-500'>
                    <div>{n.au}</div>
                    <div className='flex items-center gap-2 mb-0.5'>
                      <span
                        className='inline-block w-2 h-2 rounded-full mt-0.5 border border-[#333333]'
                        style={{ background: cidToColor(n.cid) }}
                        aria-hidden
                      />
                      <span className='text-neutral-400'>
                        {clusters[String(n.cid)]?.label ?? `Cluster ${n.cid}`} •{' '}
                        {n.dm}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      {/* NEW: Floating Cluster Legend (bottom-left) */}
      <ClusterLegendOverlay clusters={clusters} />
    </div>
  )
}
