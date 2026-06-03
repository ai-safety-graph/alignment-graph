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
import { Trash, Search, Newspaper, ChevronDown } from 'lucide-react'

import { useForceConfig } from '../hooks/useForceConfig'
import { useGraphShortcuts } from '../hooks/useGraphShortcuts'
import { cidToColor } from '../lib/colors'
import { buildAdjacency, clamp } from '../lib/graph'
import type {
  ClustersLegend,
  GraphDataCompact,
  LinkCompact,
  NodeCompact,
} from '../lib/types'
import type { SearchResult } from '../lib/api'

import GraphPaperDetails from './GraphPaperDetails'
import SearchResultsOverlay from './SearchResultsOverlay'
import ClusterLegendOverlay from './ClusterLegendOverlay'

const DEMO_PAPER_IDS = [
  'https://arxiv.org/abs/2401.02843', // Thousands of AI Authors on the Future of AI
  'https://arxiv.org/abs/2510.05519', // Assessing Human Rights Risks in AI
  'https://arxiv.org/abs/2510.08314', // To Ask or Not to Ask: Learning to Require Human Feedback
  'https://arxiv.org/abs/2510.08211', // LLMs Learn to Deceive Unintentionally
  'https://arxiv.org/abs/2510.09462', // Adaptive Attacks on Trusted Monitors Subvert AI Control Protocols
  'https://arxiv.org/abs/2510.08792', // Assurance of Frontier AI Built for National Security
  'https://arxiv.org/abs/2510.09090', // AI and Human Oversight: A Risk-Based Framework for Alignment
  'https://arxiv.org/abs/2412.07727', // AI Expands Scientists' Impact but Contracts Science's Focus
  'https://arxiv.org/abs/2505.18942', // Language Models Surface the Unwritten Code of Science and Society
  'https://arxiv.org/abs/2510.06559', // The Algebra of Meaning: Why Machines Need Montague More Than Moore's Law
]

export default function ArxivGraph({
  src = '/graph.json',
  onToggleView,
  paperIds,
}: {
  src?: string
  onToggleView?: () => void
  paperIds?: string[]
}) {
  const fgRef = useRef<ForceGraphMethods | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [data, setData] = useState<GraphDataCompact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)

  const [hoverId, setHoverId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lockedId, setLockedId] = useState<number | null>(null)
  const activeId = lockedId ?? hoverId

  const [query, setQuery] = useState('')
  const [apiResults, setApiResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [ghostSimNodes, setGhostSimNodes] = useState<
    Array<NodeCompact & { x: number; y: number }>
  >([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
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
        const { fetchSubgraph } = await import('../lib/api')
        const ids = paperIds?.length ? paperIds : DEMO_PAPER_IDS
        const json = await fetchSubgraph(ids)
        if (!alive) return
        setData(json)
        setIsDemo(!paperIds?.length)
      } catch (e: any) {
        if (!alive) return
        setError(`Failed to load graph: ${e?.message ?? String(e)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [paperIds])

  // Prepare simulation nodes (mutable x/y)
  const simNodes = useMemo(() => {
    if (!data) return [] as (NodeCompact & { x: number; y: number })[]
    const pin = data.meta.coords.included
    return data.nodes.map((n) => ({
      ...n,
      x: n.x ?? 0,
      y: n.y ?? 0,
      ...(pin ? { fx: n.x ?? 0, fy: n.y ?? 0 } : {}),
    }))
  }, [data])

  const simNodesRef = useRef(simNodes)
  useEffect(() => {
    simNodesRef.current = simNodes
  }, [simNodes])

  const simById = useMemo(() => {
    const m = new Map<number, any>()
    for (const n of simNodes) m.set(n.id, n)
    for (const n of ghostSimNodes) m.set(n.id, n)
    return m
  }, [simNodes, ghostSimNodes])

  const aidToId = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of simNodes) m.set(n.aid, n.id)
    for (const n of ghostSimNodes) m.set(n.aid, n.id)
    return m
  }, [simNodes, ghostSimNodes])

  const ghostIds = useMemo(
    () => new Set(ghostSimNodes.map((n) => n.id)),
    [ghostSimNodes],
  )

  const { byId, adj, clusters } = useMemo(() => {
    if (!data) {
      return {
        byId: new Map<number, NodeCompact>(),
        adj: new Map<number, Array<{ id: number; w: number }>>(),
        clusters: {} as ClustersLegend,
      }
    }
    const { byId, adj } = buildAdjacency(data.nodes, data.links)
    for (const n of ghostSimNodes) byId.set(n.id, n)
    return { byId, adj, clusters: data.clusters }
  }, [data, ghostSimNodes])

  // Debounced backend search
  const searchTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    setGhostSimNodes([])

    if (!query.trim()) {
      setApiResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const { searchPapers, fetchSubgraph } = await import('../lib/api')
        const res = await searchPapers(query, { limit: 50 })
        setApiResults(res.results)

        const existingAids = new Set(simNodesRef.current.map((n) => n.aid))
        const ghostAids = res.results
          .map((r) => r.aid)
          .filter((aid) => !existingAids.has(aid))
        if (ghostAids.length > 0) {
          const ghostData = await fetchSubgraph(ghostAids)
          const maxId =
            simNodesRef.current.reduce((m, n) => Math.max(m, n.id), 0) + 1
          let nextId = maxId
          const pin = ghostData.meta.coords.included
          const ghosts = ghostData.nodes.map((n) => ({
            ...n,
            id: nextId++,
            x: n.x ?? 0,
            y: n.y ?? 0,
            ...(pin ? { fx: n.x ?? 0, fy: n.y ?? 0 } : {}),
          }))
          setGhostSimNodes(ghosts as any)
        }
      } catch {
        setApiResults([])
      } finally {
        setIsSearching(false)
      }
    }, 350)
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    }
  }, [query])

  // Search results for overlay
  const searchResults = useMemo(() => {
    if (!apiResults.length) return []
    return apiResults.map((r) => ({
      n: { ...r, id: aidToId.get(r.aid) ?? 0 } as NodeCompact,
      score: r.sim ?? 0,
      deg: adj.get(aidToId.get(r.aid) ?? -1)?.length ?? 0,
    }))
  }, [apiResults, aidToId, adj])

  const onSearchPick = (aid: string) => {
    const graphId = aidToId.get(aid)
    if (graphId !== undefined) {
      setSelectedId(graphId)
      setLockedId(graphId)
      focusNodeById(graphId)
    } else {
      const r = apiResults.find((r) => r.aid === aid)
      if (r?.ln) window.open(r.ln, '_blank', 'noopener')
    }
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
      if (ghostIds.has(id)) return false
      if (lockedId != null || selectedId != null) return !!neighborSet?.has(id)
      return true
    },
    [lockedId, selectedId, neighborSet, ghostIds],
  )

  // Selection + neighbors
  const selected = useMemo(
    () => (selectedId != null ? (byId.get(selectedId) ?? null) : null),
    [selectedId, byId],
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

  // ESC unlock (global)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hoverId != null) setPinned(simById.get(hoverId) as any, false)
        if (lockedId != null) setPinned(simById.get(lockedId) as any, false)
        setLockedId(null)
        setHoverId(null)
        setSelectedId(null)
        fgRef.current?.zoomToFit(400, fitPadding())
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [hoverId, lockedId, simById])

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const fitPadding = () => (simNodes.length === 1 ? 400 : 150)

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
    prevNode?: NodeObject | null,
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
    fgRef.current?.zoomToFit(400, fitPadding())
    setLockedId(null)
    setHoverId(null)
    setSelectedId(null)
  }

  // Keyboard shortcuts
  useGraphShortcuts({ query, setQuery, onBackgroundClick, searchInputRef })

  const allSimNodes = useMemo(
    () => [...simNodes, ...ghostSimNodes],
    [simNodes, ghostSimNodes],
  )

  if (error) return <div className='text-red-600 p-4'>{error}</div>

  // Rendering helpers
  const nodeCanvasObject = (
    node: NodeObject,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const n = node as unknown as NodeCompact
    const r = 4
    ctx.save()
    let alpha = 1
    if (ghostIds.has(n.id)) alpha = 0.35
    if (neighborSet)
      alpha = neighborSet.has(n.id) ? 1 : ghostIds.has(n.id) ? 0.2 : 0.08
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
            nodes: allSimNodes as any[],
            links: (data.links as any[]) ?? [],
          }}
          backgroundColor='#1a1a1a'
          nodeId='id'
          linkSource='s'
          linkTarget='t'
          cooldownTicks={data.meta.coords.included ? 0 : 90}
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
          onEngineStop={() => {
            if (!didAutoFit.current) {
              fgRef.current?.zoomToFit(500, fitPadding())
              didAutoFit.current = true
            }
          }}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
          onBackgroundClick={onBackgroundClick}
        />
      )}

      {/* Search bar */}
      <div className='fixed top-3 left-1/2 -translate-x-1/2 z-10'>
        <div className='bg-[#2a2a2a] backdrop-blur-xs rounded-3xl w-[min(550px,80vw)] border border-[#333333]'>
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
      </div>

      {/* Overlays */}
      {query && (searchResults.length > 0 || isSearching) && (
        <SearchResultsOverlay
          results={searchResults}
          onSelect={onSearchPick}
          clusters={clusters}
          isLoading={isSearching}
        />
      )}

      {selected && (
        <GraphPaperDetails
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

      {/* Stats toggle + subgraph dropdown */}
      <div className='fixed top-4 left-4 z-10 flex items-center gap-2'>
        <button
          aria-label='Show stats'
          onClick={onToggleView}
          className='p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
        >
          <Newspaper size={18} />
        </button>

        <div className='relative' ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen((o) => !o)}
            className='flex items-center gap-1.5 px-3 py-[7px] rounded-full bg-[#2a2a2a] border border-[#333333] text-sm text-neutral-400 hover:text-neutral-200 whitespace-nowrap cursor-pointer'
          >
            {isDemo ? 'Demo subgraph' : 'Custom subgraph'}
            <ChevronDown
              size={13}
              className={`transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {isDropdownOpen && (
            <div className='absolute top-full mt-1 left-0 bg-[#2a2a2a] border border-[#333333] rounded-xl overflow-hidden shadow-lg min-w-[160px]'>
              <a
                href='/stats'
                className='block px-3 py-2 text-sm text-neutral-300 hover:bg-[#333333] hover:text-neutral-100'
              >
                Create a subgraph
              </a>
            </div>
          )}
        </div>
      </div>

      <ClusterLegendOverlay clusters={clusters} />
      <div className='fixed right-4 top-4 z-10'>
        <a
          target='_blank'
          href='https://github.com/ai-safety-graph/alignment-graph'
        >
          <img
            src='/ag-logo.svg'
            alt='Alignment Graph Logo'
            className='h-10 w-auto opacity-50 saturate-70'
          />
        </a>
      </div>
    </div>
  )
}
