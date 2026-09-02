import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from 'react-force-graph-2d'
import { Trash, Search, Library, Sparkles } from 'lucide-react'

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
import type { RelatedPaper, SearchResult } from '../lib/api'
import { listSavedGraphs, updateSavedGraph } from '../lib/storage'
import type { SavedGraph } from '../lib/storage'

import GraphPaperDetails from './GraphPaperDetails'
import SearchResultsOverlay from './SearchResultsOverlay'
import ClusterLegendOverlay from './ClusterLegendOverlay'
import Dropdown from './Dropdown'
import { useCapabilities } from '../hooks/useCapabilities'

// Safety cap on the fallback graph's size; the from/to date window is what
// actually bounds it under normal volume.
const RECENT_PAPERS_LIMIT = 200

// A node once it's in the force simulation: always has a live x/y position,
// and fx/fy when pinned (dragged, hovered while locked, or coordinate-pinned).
type SimNode = NodeCompact & { x: number; y: number; fx?: number; fy?: number }

// Map a paper's raw global coords (rx, ry) into the main graph's canvas space,
// mirroring the backend normalization in graph.py so ghost nodes land at the
// correct position relative to the already-loaded nodes.
function ghostCoord(
  rx: number,
  ry: number,
  coords: GraphDataCompact['meta']['coords'],
): { x: number; y: number } {
  const b = coords.bounds!
  const c = coords.canvas
  const xr = Math.max(b.x_max - b.x_min, 1e-9)
  const yr = Math.max(b.y_max - b.y_min, 1e-9)
  return {
    x: c.pad + ((rx - b.x_min) / xr) * (c.w - 2 * c.pad),
    y: c.pad + ((ry - b.y_min) / yr) * (c.h - 2 * c.pad),
  }
}

export default function ArxivGraph({
  src = '/graph.json',
  paperIds,
}: {
  src?: string
  paperIds?: string[]
}) {
  const fgRef = useRef<ForceGraphMethods<NodeCompact, LinkCompact> | undefined>(
    undefined,
  )
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { semanticSearch: semanticSearchEnabled } = useCapabilities()

  const [savedGraphs, setSavedGraphs] = useState<SavedGraph[]>(() =>
    listSavedGraphs().sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    ),
  )
  const [activeSavedGraph, setActiveSavedGraph] = useState<SavedGraph | null>(
    () => (paperIds?.length ? null : (savedGraphs[0] ?? null)),
  )

  const addToActiveSavedGraph = (aid: string) => {
    if (!activeSavedGraph) return
    const current = savedGraphs.find((s) => s.id === activeSavedGraph.id)
    if (!current || current.paperIds.includes(aid)) return
    const updated = updateSavedGraph(activeSavedGraph.id, {
      paperIds: [...current.paperIds, aid],
    })
    setSavedGraphs((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    )
    setActiveSavedGraph(updated)
  }

  const removeFromActiveSavedGraph = (aid: string) => {
    if (!activeSavedGraph) return
    const current = savedGraphs.find((s) => s.id === activeSavedGraph.id)
    if (!current) return
    const updated = updateSavedGraph(activeSavedGraph.id, {
      paperIds: current.paperIds.filter((id) => id !== aid),
    })
    setSavedGraphs((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    )
    setActiveSavedGraph(updated)
  }

  const wantsRecentPapers = !paperIds?.length && !activeSavedGraph

  // Fallback graph when nothing is explicitly selected: papers published in
  // the last month, refetched periodically so the default view stays fresh.
  const { data: recentPapers } = useQuery({
    queryKey: ['recentPapers'],
    queryFn: async () => {
      const { fetchPapers } = await import('../lib/api')
      const to = new Date()
      const from = new Date(to)
      from.setMonth(from.getMonth() - 1)
      return fetchPapers({
        limit: RECENT_PAPERS_LIMIT,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      })
    },
    enabled: wantsRecentPapers,
    staleTime: 5 * 60 * 1000,
  })

  const ids = paperIds?.length
    ? paperIds
    : (activeSavedGraph?.paperIds ??
      recentPapers?.items.map((p) => p.aid) ??
      [])

  const isDemo = wantsRecentPapers
  const isEmptySavedGraph =
    !paperIds?.length && !!activeSavedGraph && activeSavedGraph.paperIds.length === 0

  const [hoverId, setHoverId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lockedId, setLockedId] = useState<number | null>(null)
  const activeId = lockedId ?? hoverId

  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>(
    'keyword',
  )
  const [query, setQuery] = useState('')
  const [apiResults, setApiResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [ghostSimNodes, setGhostSimNodes] = useState<SimNode[]>([])
  const [relatedGhostNodes, setRelatedGhostNodes] = useState<SimNode[]>([])
  const [related, setRelated] = useState<RelatedPaper[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
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

  // Data fetch. Cached by ids so revisiting the same graph (e.g. navigating
  // away to /stats and back) doesn't refire /api/graph/subset.
  const {
    data,
    error: queryError,
    isLoading: isGraphLoading,
  } = useQuery({
    queryKey: ['subgraph', ids],
    queryFn: async () => {
      const { fetchSubgraph } = await import('../lib/api')
      return fetchSubgraph(ids)
    },
    // An empty saved graph has no papers to fetch; the backend rejects an
    // empty ids list, so skip the request and show an empty-state instead.
    enabled: ids.length > 0,
  })
  const error = queryError
    ? `Failed to load graph: ${queryError.message}`
    : null

  // Full cluster legend, independent of which papers are currently loaded.
  const { data: allClusters } = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => {
      const { fetchClusters } = await import('../lib/api')
      return fetchClusters()
    },
    staleTime: Infinity,
  })

  // Prepare simulation nodes (mutable x/y)
  const simNodes = useMemo(() => {
    if (!data) return [] as SimNode[]
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

  const ghostSimNodesRef = useRef(ghostSimNodes)
  useEffect(() => {
    ghostSimNodesRef.current = ghostSimNodes
  }, [ghostSimNodes])

  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const simById = useMemo(() => {
    const m = new Map<number, SimNode>()
    for (const n of simNodes) m.set(n.id, n)
    for (const n of ghostSimNodes) m.set(n.id, n)
    for (const n of relatedGhostNodes) m.set(n.id, n)
    return m
  }, [simNodes, ghostSimNodes, relatedGhostNodes])

  const aidToId = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of simNodes) m.set(n.aid, n.id)
    for (const n of ghostSimNodes) m.set(n.aid, n.id)
    for (const n of relatedGhostNodes) m.set(n.aid, n.id)
    return m
  }, [simNodes, ghostSimNodes, relatedGhostNodes])

  const ghostIds = useMemo(
    () =>
      new Set([
        ...ghostSimNodes.map((n) => n.id),
        ...relatedGhostNodes.map((n) => n.id),
      ]),
    [ghostSimNodes, relatedGhostNodes],
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
    for (const n of relatedGhostNodes) byId.set(n.id, n)
    return { byId, adj, clusters: data.clusters }
  }, [data, ghostSimNodes, relatedGhostNodes])

  const clusterLabels = allClusters ?? ({} as ClustersLegend)

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
        const { searchPapers, fetchPapers, fetchSubgraph } =
          await import('../lib/api')
        let results: SearchResult[]
        if (searchMode === 'semantic') {
          const res = await searchPapers(query, { limit: 50 })
          results = res.results
        } else {
          const res = await fetchPapers({ q: query, limit: 50 })
          results = res.items.map((item, i) => ({ ...item, id: i, sim: null }))
        }
        setApiResults(results)

        const existingAids = new Set(simNodesRef.current.map((n) => n.aid))
        const ghostAids = results
          .map((r) => r.aid)
          .filter((aid) => !existingAids.has(aid))
        if (ghostAids.length > 0) {
          const ghostData = await fetchSubgraph(ghostAids)
          const maxId =
            simNodesRef.current.reduce((m, n) => Math.max(m, n.id), 0) + 1
          let nextId = maxId
          const coords = dataRef.current?.meta.coords
          const pin = !!coords?.included
          const ghosts = ghostData.nodes.map((n) => {
            const pos =
              coords?.bounds && n.rx != null && n.ry != null
                ? ghostCoord(n.rx, n.ry, coords)
                : { x: n.x ?? 0, y: n.y ?? 0 }
            return {
              ...n,
              id: nextId++,
              x: pos.x,
              y: pos.y,
              ...(pin ? { fx: pos.x, fy: pos.y } : {}),
            }
          })
          setGhostSimNodes(ghosts)
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
  }, [query, searchMode])

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
    if (ghostIds.has(activeId)) return null
    const s = new Set<number>([activeId])
    for (const { id } of adj.get(activeId) ?? []) s.add(id)
    return s
  }, [activeId, adj, ghostIds])

  // Interaction gating
  const isInteractive = useCallback(
    (id: number) => {
      if (ghostIds.has(id)) return true
      if (activeId != null && ghostIds.has(activeId)) return true
      if (lockedId != null || selectedId != null) return !!neighborSet?.has(id)
      return true
    },
    [lockedId, selectedId, neighborSet, ghostIds, activeId],
  )

  // Selection + neighbors
  const selected = useMemo(
    () => (selectedId != null ? (byId.get(selectedId) ?? null) : null),
    [selectedId, byId],
  )

  // Build ghost nodes for a selected paper's related papers, positioned in the
  // main graph's coordinate space. Replaces the previous related-ghost set,
  // retaining the selected node itself if it is already a related ghost.
  const buildRelatedGhosts = useCallback(
    (sel: NodeCompact, results: RelatedPaper[]) => {
      const coords = data?.meta.coords
      if (!coords?.bounds) {
        setRelatedGhostNodes([])
        return
      }
      const sims = simNodesRef.current
      const searchGhosts = ghostSimNodesRef.current
      const existingAids = new Set<string>()
      for (const n of sims) existingAids.add(n.aid)
      for (const n of searchGhosts) existingAids.add(n.aid)
      const pin = coords.included

      setRelatedGhostNodes((prev) => {
        const retained = prev.filter((n) => n.id === sel.id)
        const seenAids = new Set(retained.map((n) => n.aid))
        let nextId =
          Math.max(
            0,
            ...sims.map((n) => n.id),
            ...searchGhosts.map((n) => n.id),
            ...retained.map((n) => n.id),
          ) + 1
        const built = retained.slice()
        for (const r of results) {
          if (r.rx == null || r.ry == null) continue
          if (r.aid === sel.aid) continue
          if (existingAids.has(r.aid) || seenAids.has(r.aid)) continue
          seenAids.add(r.aid)
          const { x, y } = ghostCoord(r.rx, r.ry, coords)
          built.push({
            id: nextId++,
            aid: r.aid,
            t: r.t,
            au: r.au,
            pd: r.pd,
            dm: r.dm,
            ln: r.ln,
            cid: r.cid,
            x,
            y,
            ...(pin ? { fx: x, fy: y } : {}),
          } as SimNode)
        }
        return built
      })
    },
    [data],
  )

  // Fetch related papers for the selected node and build their ghost nodes.
  useEffect(() => {
    if (!selected) {
      setRelated([])
      setRelatedLoading(false)
      setRelatedGhostNodes([])
      return
    }
    const sel = selected
    let alive = true
    setRelated([])
    setRelatedLoading(true)
    ;(async () => {
      try {
        const { fetchRelated } = await import('../lib/api')
        const results = await fetchRelated(sel.aid, 10)
        if (!alive) return
        setRelated(results)
        buildRelatedGhosts(sel, results)
      } catch {
        if (alive) {
          setRelated([])
          setRelatedGhostNodes([])
        }
      } finally {
        if (alive) setRelatedLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.aid, buildRelatedGhosts])

  // Force configuration
  useForceConfig(fgRef, !!data)

  // Autofit once per graph source
  const didAutoFit = useRef(false)
  useEffect(() => {
    didAutoFit.current = false
  }, [src, activeSavedGraph])

  // ESC unlock (global)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hoverId != null && !ghostIds.has(hoverId))
          setPinned(simById.get(hoverId), false)
        if (lockedId != null && !ghostIds.has(lockedId))
          setPinned(simById.get(lockedId), false)
        setLockedId(null)
        setHoverId(null)
        setSelectedId(null)
        fgRef.current?.zoomToFit(400, fitPadding())
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [hoverId, lockedId, simById])

  const fitPadding = () => (simNodes.length === 1 ? 400 : 150)

  // Focus helpers
  function focusNode(
    simNode: SimNode | undefined,
    zoomLevel = 1.1,
    duration = 600,
  ) {
    const fg = fgRef.current
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
  function setPinned(n: NodeObject<NodeCompact> | null | undefined, pinned: boolean) {
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
    node: NodeObject<NodeCompact> | null,
    prevNode?: NodeObject<NodeCompact> | null,
  ) => {
    if (node && !isInteractive(node.id)) {
      setPinned(prevNode, false)
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
      hoverTimer.current = window.setTimeout(() => setHoverId(null), 120)
      return
    }
    if (lockedId != null) return
    setPinned(prevNode, false)
    setPinned(node, true)
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    if (node) setHoverId(node.id)
    else hoverTimer.current = window.setTimeout(() => setHoverId(null), 120)
  }

  const onNodeClick = (node: NodeObject<NodeCompact>) => {
    if (ghostIds.has(node.id)) {
      setSelectedId(node.id)
      setLockedId(node.id)
      return
    }
    if (!isInteractive(node.id)) return
    setSelectedId(node.id)
    setLockedId(node.id)
    setPinned(node, true)
    focusNode(node as SimNode)
  }

  const onBackgroundClick = () => {
    if (hoverId != null && !ghostIds.has(hoverId))
      setPinned(simById.get(hoverId), false)
    if (lockedId != null && !ghostIds.has(lockedId))
      setPinned(simById.get(lockedId), false)
    fgRef.current?.zoomToFit(400, fitPadding())
    setLockedId(null)
    setHoverId(null)
    setSelectedId(null)
  }

  // Keyboard shortcuts
  useGraphShortcuts({ query, setQuery, onBackgroundClick, searchInputRef })

  const allSimNodes = useMemo(
    () => [...simNodes, ...ghostSimNodes, ...relatedGhostNodes],
    [simNodes, ghostSimNodes, relatedGhostNodes],
  )

  if (error) return <div className='text-red-600 p-4'>{error}</div>

  // Rendering helpers
  const nodeCanvasObject = (
    node: NodeObject<NodeCompact>,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const n = node as SimNode
    const r = 4
    ctx.save()
    let alpha = 1
    if (ghostIds.has(n.id)) {
      // ghosts (search + related) keep their own alpha, never dimmed by neighborSet
      alpha = activeId === n.id ? 0.85 : 0.35
    } else if (neighborSet) {
      alpha = neighborSet.has(n.id) ? 1 : 0.08
    }
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.fillStyle = cidToColor(n.cid)
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI, false)
    ctx.fill()
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.stroke()
    if (relatedLoading && selectedId === n.id) {
      const angle = (Date.now() / 300) % (Math.PI * 2)
      ctx.save()
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#4ea8de'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(n.x, n.y, r + 4, angle, angle + Math.PI * 1.3)
      ctx.stroke()
      ctx.restore()
    }
    const drawLabel = neighborSet?.has(n.id) || selectedId === n.id
    if (drawLabel && globalScale > 0.8) {
      const label = n.t.length > 80 ? n.t.slice(0, 77) + '…' : n.t
      const fontSize = 10 / Math.sqrt(globalScale)
      ctx.globalAlpha = 1
      ctx.font = `${fontSize}px sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillText(label, n.x + 6, n.y + 3)
    }
    ctx.restore()
  }

  const linkColor = (link: LinkObject<NodeCompact, LinkCompact>) => {
    const alpha = clamp(0.15 + (link.w ?? 0) * 0.7, 0.15, 0.85)
    return `rgba(220,220,220,${alpha})`
  }

  const nodeLabel = (node: NodeObject<NodeCompact>) => node.t

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5]'>
      {isGraphLoading && ids.length > 0 && (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-3'>
          <span className='h-8 w-8 rounded-full border-2 border-neutral-700 border-t-neutral-300 animate-spin' />
          <p className='text-sm text-neutral-500'>Loading graph…</p>
        </div>
      )}
      {isEmptySavedGraph && (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center'>
          <p className='text-lg text-neutral-300'>
            &ldquo;{activeSavedGraph?.name}&rdquo; is empty
          </p>
          <p className='text-sm text-neutral-500 max-w-sm'>
            Search for papers above and use &ldquo;Add to subgraph&rdquo; to
            start building it out.
          </p>
        </div>
      )}
      {data && width > 0 && height > 0 && (
        <ForceGraph2D<NodeCompact, LinkCompact>
          ref={fgRef}
          width={width}
          height={height}
          graphData={{
            nodes: allSimNodes,
            links: data.links,
          }}
          backgroundColor='#1a1a1a'
          nodeId='id'
          linkSource='s'
          linkTarget='t'
          cooldownTicks={data.meta.coords.included ? 0 : 90}
          autoPauseRedraw={!relatedLoading}
          enableNodeDrag={false}
          nodeCanvasObject={nodeCanvasObject}
          nodeLabel={nodeLabel}
          linkColor={linkColor}
          nodePointerAreaPaint={(n: NodeObject<NodeCompact>, color, ctx) => {
            if (!isInteractive(n.id)) return
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(n.x ?? 0, n.y ?? 0, 10, 0, 2 * Math.PI)
            ctx.fill()
          }}
          linkVisibility={(l: LinkObject<NodeCompact, LinkCompact>) => {
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
      <div className='fixed top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2'>
        <div className='bg-[#2a2a2a] backdrop-blur-xs rounded-md w-[min(550px,80vw)] border border-[#333333]'>
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
                className='w-full pl-9 pr-20 py-1 rounded-md bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
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
                className='px-2 py-1 rounded-md cursor-pointer text-neutral-300 hover:text-white flex items-center gap-2'
              >
                <Trash size={15} />
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
        {semanticSearchEnabled && (
          <>
            <button
              type='button'
              onClick={() =>
                setSearchMode((m) =>
                  m === 'semantic' ? 'keyword' : 'semantic',
                )
              }
              className={`shrink-0 px-2 py-1 rounded-md bg-[#2a2a2a] border cursor-pointer transition-colors ${
                searchMode === 'semantic'
                  ? 'border-[#4ea8de] text-[#4ea8de]'
                  : 'border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white'
              }`}
            >
              <Sparkles size={15} />
            </button>
            <span
              className={`shrink-0 text-[13px] whitespace-nowrap transition-colors ${searchMode === 'semantic' ? 'text-[#4ea8de]' : 'text-neutral-500'}`}
            >
              {searchMode === 'semantic'
                ? 'semantic search on'
                : 'semantic search off'}
            </span>
          </>
        )}
      </div>

      {/* Overlays */}
      {/* Search results overlay flexes to fill the space above the cluster
          legend, so its bottom edge always meets the legend's top edge
          regardless of the legend's (dynamic) height. */}
      <div className='fixed left-4 top-[72px] bottom-4 z-10 flex flex-col items-start justify-end gap-3 pointer-events-none'>
        {query && (searchResults.length > 0 || isSearching) && (
          <div className='flex-1 min-h-0 w-[360px] pointer-events-auto'>
            <SearchResultsOverlay
              results={searchResults}
              onSelect={onSearchPick}
              clusters={clusterLabels}
              isLoading={isSearching}
              onAddToSubgraph={
                activeSavedGraph ? addToActiveSavedGraph : undefined
              }
              onRemoveFromSubgraph={
                activeSavedGraph ? removeFromActiveSavedGraph : undefined
              }
              subgraphPaperIds={
                activeSavedGraph ? new Set(activeSavedGraph.paperIds) : undefined
              }
              subgraphName={activeSavedGraph?.name}
            />
          </div>
        )}
        <div className='shrink-0 pointer-events-auto'>
          <ClusterLegendOverlay clusters={clusters} />
        </div>
      </div>

      {selected && (
        <GraphPaperDetails
          paper={selected}
          clusters={clusterLabels}
          related={related}
          relatedLoading={relatedLoading}
          onClose={onBackgroundClick}
          onAddToSubgraph={activeSavedGraph ? addToActiveSavedGraph : undefined}
          onRemoveFromSubgraph={
            activeSavedGraph ? removeFromActiveSavedGraph : undefined
          }
          subgraphPaperIds={
            activeSavedGraph ? new Set(activeSavedGraph.paperIds) : undefined
          }
          subgraphName={activeSavedGraph?.name}
          onSelectPaper={(aid) => {
            const id = aidToId.get(aid)
            if (id == null) return
            setSelectedId(id)
            setLockedId(id)
            focusNodeById(id)
          }}
        />
      )}

      {/* Stats toggle + subgraph dropdown */}
      <div className='fixed top-4 left-4 z-10 flex items-center gap-2'>
        <Link
          to='/stats'
          aria-label='Show stats'
          className='px-2 py-1 rounded-md cursor-pointer bg-[#2a2a2a] border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors'
        >
          <Library size={18} />
        </Link>

        <Dropdown
          label={
            isDemo
              ? 'Recent papers'
              : (activeSavedGraph?.name ?? 'Custom subgraph')
          }
        >
          {savedGraphs.map((g) => (
            <button
              key={g.id}
              type='button'
              onClick={() => {
                setActiveSavedGraph(g)
                setSelectedId(null)
                setLockedId(null)
                setHoverId(null)
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-[#333333] cursor-pointer transition-colors ${
                activeSavedGraph?.id === g.id
                  ? 'text-[#4ea8de]'
                  : 'text-neutral-300'
              }`}
            >
              {g.name}
            </button>
          ))}
          {savedGraphs.length > 0 && (
            <button
              type='button'
              onClick={() => {
                setActiveSavedGraph(null)
                setSelectedId(null)
                setLockedId(null)
                setHoverId(null)
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-[#333333] cursor-pointer border-t border-[#333333] transition-colors ${
                isDemo ? 'text-[#4ea8de]' : 'text-neutral-400'
              }`}
            >
              Recent papers
            </button>
          )}
        </Dropdown>

        {/* <Link
          to='/stats'
          aria-label='Show stats'
          className='shrink-0 flex items-center gap-1.5 px-3 py-[7px] rounded-full bg-[#2a2a2a] border border-[#333333] text-sm text-neutral-400 hover:text-neutral-200 whitespace-nowrap cursor-pointer'
        >
          New Graph
          <Plus size={13} />
        </Link> */}
      </div>

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
