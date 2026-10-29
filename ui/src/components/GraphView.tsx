import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from 'react-force-graph-2d'
import {
  Trash,
  Trash2,
  Search,
  Library,
  Sparkles,
  Plus,
  Pencil,
  Info,
} from 'lucide-react'

import { useForceConfig } from '../hooks/useForceConfig'
import { useGraphShortcuts } from '../hooks/useGraphShortcuts'
import {
  buildAdjacency,
  clamp,
  RELATED_GHOST_NODE_COLOR,
  SEARCH_GHOST_NODE_COLOR,
  separatePoints,
  stepAlpha,
  SUBGRAPH_NODE_COLOR,
} from '../lib/graph'
import type { GraphDataCompact, LinkCompact, NodeCompact } from '../lib/types'
import type { RelatedPaper, SearchResult } from '../lib/api'
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
  MAX_GRAPH_NAME_LENGTH,
  updateSavedGraph,
} from '../lib/storage'
import type { SavedGraph } from '../lib/storage'
import {
  defaultGraphName,
  EMPTY_FILTERS,
  toRangeParams,
} from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'

import GraphLegend from './GraphLegend'
import GraphPaperDetails from './GraphPaperDetails'
import SearchResultsOverlay from './SearchResultsOverlay'
import Dropdown from './Dropdown'
import DraftGraphBar from './DraftGraphBar'
import GenerateGraphModal from './GenerateGraphModal'
import LoadingIndicator from './LoadingIndicator'
import LatestBatchBadge from './LatestBatchBadge'
import { track } from '../lib/analytics'
import { useCapabilities } from '../hooks/useCapabilities'

// Alpha of nodes outside the active node's neighbourhood: softer while
// hovering, stronger once a node is locked. Changes fade over FADE_MS.
const DIM_ALPHA_HOVER = 0.3
const DIM_ALPHA_LOCKED = 0.15
const FADE_MS = 150

// Node radius in graph units, and the minimum centre-to-centre spacing that
// pinned nodes are separated to (2 × radius plus a small gap).
const NODE_RADIUS = 4
const NODE_MIN_DIST = 2 * NODE_RADIUS + 2
const SINGLE_NODE_ZOOM = 3

// A node once it's in the force simulation: always has a live x/y position,
// and fx/fy when pinned (dragged, hovered while locked, or coordinate-pinned).
type SimNode = NodeCompact & { x: number; y: number; fx?: number; fy?: number }

// Map a paper's raw global coords (rx, ry) into the main graph's canvas space,
// mirroring the backend normalization in graph.py so ghost nodes land at the
// correct position relative to the already-loaded nodes.
// When the subset has no spread on an axis (e.g. a single node), the backend's
// 1e-9 range floor would fling ghosts ~1e9 units away; raw coords are already
// in canvas units (compute_layout), so fall back to a 1:1 scale instead.
function ghostCoord(
  rx: number,
  ry: number,
  coords: GraphDataCompact['meta']['coords'],
): { x: number; y: number } {
  const b = coords.bounds!
  const c = coords.canvas
  const scale = (range: number, span: number) =>
    range > 1e-6 ? span / range : 1
  return {
    x: c.pad + (rx - b.x_min) * scale(b.x_max - b.x_min, c.w - 2 * c.pad),
    y: c.pad + (ry - b.y_min) * scale(b.y_max - b.y_min, c.h - 2 * c.pad),
  }
}

// What the canvas shows: nothing yet, an unsaved graph generated from filters
// (`basedOn` = the saved graph it was edited from), or a saved graph.
type GraphSource =
  | { kind: 'none' }
  | { kind: 'draft'; filters: GraphFilters; basedOn: SavedGraph | null }
  | { kind: 'saved'; graph: SavedGraph }

type ModalState = {
  mode: 'generate' | 'edit'
  initialFilters: GraphFilters
  basedOn: SavedGraph | null
}

const NEW_GRAPH_MODAL: ModalState = {
  mode: 'generate',
  initialFilters: EMPTY_FILTERS,
  basedOn: null,
}

function byUpdatedDesc(a: SavedGraph, b: SavedGraph) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
}

export default function ArxivGraph() {
  const fgRef = useRef<ForceGraphMethods<NodeCompact, LinkCompact> | undefined>(
    undefined,
  )
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { semanticSearch: semanticSearchEnabled } = useCapabilities()
  const queryClient = useQueryClient()

  const [savedGraphs, setSavedGraphs] = useState<SavedGraph[]>(() =>
    listSavedGraphs().sort(byUpdatedDesc),
  )
  // Returning visitors land on their most recently used saved graph; first
  // visitors get the Generate graph modal.
  const [source, setSource] = useState<GraphSource>(() =>
    savedGraphs[0]
      ? { kind: 'saved', graph: savedGraphs[0] }
      : { kind: 'none' },
  )
  const [modal, setModal] = useState<ModalState | null>(() =>
    savedGraphs.length ? null : NEW_GRAPH_MODAL,
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Saved graph picked while a draft is open, waiting on "discard the draft?"
  const [pendingSavedGraph, setPendingSavedGraph] = useState<SavedGraph | null>(
    null,
  )
  const activeSavedGraph = source.kind === 'saved' ? source.graph : null
  const setActiveSavedGraph = (graph: SavedGraph) =>
    setSource({ kind: 'saved', graph })

  // Last saved graph shown, so discarding a draft can go back to it.
  const lastSavedIdRef = useRef<string | null>(activeSavedGraph?.id ?? null)
  useEffect(() => {
    if (activeSavedGraph) lastSavedIdRef.current = activeSavedGraph.id
  }, [activeSavedGraph])

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

  // A draft is fetched straight from its filters in one request. Uses the
  // app-wide infinite staleTime, so regenerating the same filters is free.
  const draftFilters = source.kind === 'draft' ? source.filters : null
  const {
    data: draftGraph,
    isLoading: isDraftLoading,
    error: draftError,
  } = useQuery({
    queryKey: ['graphRange', draftFilters],
    queryFn: async () => {
      const { fetchGraphRange } = await import('../lib/api')
      return fetchGraphRange(toRangeParams(draftFilters!))
    },
    enabled: !!draftFilters,
  })

  const ids = activeSavedGraph?.paperIds ?? []

  const isEmptySavedGraph =
    !!activeSavedGraph && activeSavedGraph.paperIds.length === 0

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
  // away to /browse and back) doesn't refire /api/graph/subset.
  const {
    data: subgraph,
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
  const data =
    source.kind === 'draft'
      ? draftGraph
      : source.kind === 'saved'
        ? subgraph
        : undefined
  const error =
    source.kind === 'draft' && draftError
      ? `Failed to generate graph: ${draftError.message}`
      : source.kind === 'saved' && queryError
        ? `Failed to load graph: ${queryError.message}`
        : null
  const showLoading =
    (source.kind === 'draft' && isDraftLoading) ||
    (source.kind === 'saved' && isGraphLoading && ids.length > 0)

  // Prepare simulation nodes (mutable x/y)
  // Stored coords are pinned, so the collide force never runs on them; resolve
  // overlaps once up front instead.
  const simNodes = useMemo(() => {
    if (!data) return [] as SimNode[]
    const pin = data.meta.coords.included
    const pos = pin
      ? separatePoints(
          data.nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 })),
          { minDist: NODE_MIN_DIST },
        )
      : data.nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }))
    return data.nodes.map((n, i) => ({
      ...n,
      ...pos[i],
      ...(pin ? { fx: pos[i].x, fy: pos[i].y } : {}),
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

  const searchGhostIds = useMemo(
    () => new Set(ghostSimNodes.map((n) => n.id)),
    [ghostSimNodes],
  )
  const ghostIds = useMemo(
    () => new Set([...searchGhostIds, ...relatedGhostNodes.map((n) => n.id)]),
    [searchGhostIds, relatedGhostNodes],
  )

  const { byId, adj } = useMemo(() => {
    if (!data) {
      return {
        byId: new Map<number, NodeCompact>(),
        adj: new Map<number, Array<{ id: number; w: number }>>(),
      }
    }
    const { byId, adj } = buildAdjacency(data.nodes, data.links)
    for (const n of ghostSimNodes) byId.set(n.id, n)
    for (const n of relatedGhostNodes) byId.set(n.id, n)
    return { byId, adj }
  }, [data, ghostSimNodes, relatedGhostNodes])

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
          const rawPos = ghostData.nodes.map((n) =>
            coords?.bounds && n.rx != null && n.ry != null
              ? ghostCoord(n.rx, n.ry, coords)
              : { x: n.x ?? 0, y: n.y ?? 0 },
          )
          const positions = pin
            ? separatePoints(rawPos, {
                minDist: NODE_MIN_DIST,
                fixed: simNodesRef.current,
              })
            : rawPos
          const ghosts = ghostData.nodes.map((n, i) => {
            const pos = positions[i]
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
    track('paper_open', { view: 'graph', source: 'search' })
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
  // Last subgraph (non-ghost) node that was locked. Ghosts have no edges, so
  // while one is locked (e.g. a related paper clicked from a selection) the
  // subgraph keeps the dimming of the node it was reached from.
  const [dimAnchorId, setDimAnchorId] = useState<number | null>(null)
  useEffect(() => {
    if (lockedId == null) setDimAnchorId(null)
    else if (!ghostIds.has(lockedId)) setDimAnchorId(lockedId)
  }, [lockedId, ghostIds])

  const neighborSet = useMemo(() => {
    if (activeId == null) return null
    const rootId = ghostIds.has(activeId) ? dimAnchorId : activeId
    if (rootId == null) return null
    const s = new Set<number>([rootId])
    for (const { id } of adj.get(rootId) ?? []) s.add(id)
    return s
  }, [activeId, dimAnchorId, adj, ghostIds])

  // Dimming fades instead of snapping: each node's last drawn alpha steps
  // toward its target every frame. Redraw is normally paused while idle, so
  // keep it running for the length of a fade after the dim set changes.
  const alphaRef = useRef(new Map<number, number>())
  const lastFrameTs = useRef<number | null>(null)
  const frameDt = useRef(0)
  const [fading, setFading] = useState(false)
  useEffect(() => {
    setFading(true)
    const t = window.setTimeout(() => setFading(false), FADE_MS + 50)
    return () => window.clearTimeout(t)
  }, [neighborSet, lockedId])
  // Ids are assigned per graph response, so alphas don't carry over.
  useEffect(() => {
    alphaRef.current.clear()
  }, [data])

  // Interaction gating
  const isInteractive = useCallback(
    (id: number) => {
      if (ghostIds.has(id)) return true
      if (activeId != null && ghostIds.has(activeId))
        return neighborSet ? neighborSet.has(id) : true
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
        const fresh: RelatedPaper[] = []
        for (const r of results) {
          if (r.rx == null || r.ry == null) continue
          if (r.aid === sel.aid) continue
          if (existingAids.has(r.aid) || seenAids.has(r.aid)) continue
          seenAids.add(r.aid)
          fresh.push(r)
        }
        const rawPos = fresh.map((r) => ghostCoord(r.rx!, r.ry!, coords))
        const positions = pin
          ? separatePoints(rawPos, {
              minDist: NODE_MIN_DIST,
              fixed: [...sims, ...searchGhosts, ...retained],
            })
          : rawPos
        const built = retained.slice()
        fresh.forEach((r, i) => {
          const { x, y } = positions[i]
          built.push({
            id: nextId++,
            aid: r.aid,
            t: r.t,
            au: r.au,
            pd: r.pd,
            dm: r.dm,
            ln: r.ln,
            tags: r.tags,
            x,
            y,
            ...(pin ? { fx: x, fy: y } : {}),
          } as SimNode)
        })
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
  const sourceKey =
    source.kind === 'draft'
      ? `draft:${JSON.stringify(source.filters)}`
      : source.kind === 'saved'
        ? `saved:${source.graph.id}`
        : 'none'
  const didAutoFit = useRef(false)
  useEffect(() => {
    didAutoFit.current = false
  }, [sourceKey])

  // ESC unlock (global). Off while the modal is open, which handles its own Esc.
  useEffect(() => {
    if (modal) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hoverId != null && !ghostIds.has(hoverId))
          setPinned(simById.get(hoverId), false)
        if (lockedId != null && !ghostIds.has(lockedId))
          setPinned(simById.get(lockedId), false)
        setLockedId(null)
        setHoverId(null)
        setSelectedId(null)
        fitView(400)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [hoverId, lockedId, simById, modal])

  // Fit the camera to the rendered nodes. Read through a ref so the ESC
  // handler's closure never fits against stale nodes or viewport size.
  // A lone node gets a fixed zoom: zoomToFit sizes the view to its tiny bbox,
  // which zooms in absurdly far, or (with padding > half the viewport) goes
  // negative and clamps to ~0, leaving nothing visible.
  const fitStateRef = useRef<{ nodes: SimNode[]; width: number; height: number }>(
    { nodes: [], width: 0, height: 0 },
  )
  function fitView(duration: number) {
    const fg = fgRef.current
    const { nodes, width: w, height: h } = fitStateRef.current
    if (!fg || nodes.length === 0) return
    if (nodes.length === 1) {
      fg.centerAt(nodes[0].x ?? 0, nodes[0].y ?? 0, duration)
      fg.zoom(SINGLE_NODE_ZOOM, duration)
      return
    }
    // zoomToFit measures force-graph's own node list, so filter it down to
    // ours or it would still frame the outgoing related ghosts.
    const ids = new Set(nodes.map((n) => n.id))
    fg.zoomToFit(duration, Math.min(150, Math.min(w, h) / 4), (n) =>
      ids.has(n.id),
    )
  }

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
  function setPinned(
    n: NodeObject<NodeCompact> | null | undefined,
    pinned: boolean,
  ) {
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
    track('paper_open', { view: 'graph', source: 'graph' })
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
    fitView(400)
    setLockedId(null)
    setHoverId(null)
    setSelectedId(null)
  }

  // Keyboard shortcuts
  useGraphShortcuts({
    query,
    setQuery,
    onBackgroundClick,
    searchInputRef,
    enabled: !modal,
  })

  // Graph source actions. Switching source drops the selection, whose ids
  // belong to the outgoing graph.
  const clearSelection = () => {
    setSelectedId(null)
    setLockedId(null)
    setHoverId(null)
  }

  const showSource = (next: GraphSource) => {
    clearSelection()
    setConfirmingDelete(false)
    setPendingSavedGraph(null)
    setSource(next)
  }

  // Opening a saved graph drops an open draft, so confirm that first
  const openSavedGraph = (graph: SavedGraph) => {
    if (source.kind === 'draft') setPendingSavedGraph(graph)
    else showSource({ kind: 'saved', graph })
  }

  const onGenerate = (filters: GraphFilters) => {
    track('graph_generate', {
      tags: filters.tags.length,
      domains: filters.domains.length,
      date: filters.datePreset,
      mode: modal?.mode ?? 'generate',
    })
    showSource({ kind: 'draft', filters, basedOn: modal?.basedOn ?? null })
    setModal(null)
  }

  const openEdit = () => {
    if (source.kind === 'draft') {
      setModal({
        mode: 'edit',
        initialFilters: source.filters,
        basedOn: source.basedOn,
      })
    } else if (source.kind === 'saved') {
      track('graph_edit')
      setModal({
        mode: 'edit',
        initialFilters: source.graph.filters ?? EMPTY_FILTERS,
        basedOn: source.graph,
      })
    }
  }

  // Stores the draft and switches to it as a saved graph. The draft's graph
  // is seeded into the subset query, which would return the same nodes at
  // the same (corpus-normalised) coords, so saving doesn't refetch.
  const saveDraft = (target: SavedGraph | null, name?: string) => {
    if (source.kind !== 'draft' || !draftGraph) return 'Graph not loaded yet'
    const paperIds = draftGraph.nodes.map((n) => n.aid)
    let saved: SavedGraph
    try {
      saved = target
        ? updateSavedGraph(target.id, { paperIds, filters: source.filters })
        : createSavedGraph(name!, paperIds, source.filters)
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save graph'
    }
    track('graph_save', { kind: target ? 'update' : 'new' })
    queryClient.setQueryData(['subgraph', paperIds], draftGraph)
    setSavedGraphs((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)])
    showSource({ kind: 'saved', graph: saved })
    return null
  }

  const discardDraft = () => {
    if (source.kind !== 'draft') return
    track('graph_discard')
    const back =
      savedGraphs.find((s) => s.id === source.basedOn?.id) ??
      savedGraphs.find((s) => s.id === lastSavedIdRef.current)
    if (back) {
      showSource({ kind: 'saved', graph: back })
    } else {
      showSource({ kind: 'none' })
      setModal(NEW_GRAPH_MODAL)
    }
  }

  const deleteActiveSavedGraph = () => {
    if (!activeSavedGraph) return
    deleteSavedGraph(activeSavedGraph.id)
    const remaining = savedGraphs.filter((s) => s.id !== activeSavedGraph.id)
    setSavedGraphs(remaining)
    if (remaining[0]) {
      showSource({ kind: 'saved', graph: remaining[0] })
    } else {
      showSource({ kind: 'none' })
      setModal(NEW_GRAPH_MODAL)
    }
  }

  const allSimNodes = useMemo(
    () => [...simNodes, ...ghostSimNodes, ...relatedGhostNodes],
    [simNodes, ghostSimNodes, relatedGhostNodes],
  )

  const graphData = useMemo(
    () => ({ nodes: allSimNodes, links: data?.links ?? [] }),
    [allSimNodes, data],
  )
  // Related ghosts are excluded: every fit (ESC / background click) also
  // deselects, which clears them right after, so fitting to them would frame
  // nodes that are about to vanish.
  fitStateRef.current = {
    nodes: allSimNodes.slice(0, allSimNodes.length - relatedGhostNodes.length),
    width,
    height,
  }

  // Rendering helpers
  const nodeCanvasObject = (
    node: NodeObject<NodeCompact>,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const n = node as SimNode
    const r = NODE_RADIUS
    ctx.save()
    let target = 1
    if (ghostIds.has(n.id)) {
      // ghosts (search + related) keep their own alpha, never dimmed by neighborSet
      target = activeId === n.id ? 0.85 : 0.55
    } else if (neighborSet && !neighborSet.has(n.id)) {
      target = lockedId != null ? DIM_ALPHA_LOCKED : DIM_ALPHA_HOVER
    }
    const alpha = stepAlpha(
      alphaRef.current.get(n.id) ?? target,
      target,
      frameDt.current,
      FADE_MS,
    )
    alphaRef.current.set(n.id, alpha)
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.fillStyle = searchGhostIds.has(n.id)
      ? SEARCH_GHOST_NODE_COLOR
      : ghostIds.has(n.id)
        ? RELATED_GHOST_NODE_COLOR
        : SUBGRAPH_NODE_COLOR
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
      ctx.arc(n.x, n.y, r + 6, angle, angle + Math.PI * 1.3)
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
      {showLoading && (
        <LoadingIndicator label='Loading graph…' className='absolute inset-0' />
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
      {error && (
        <div className='absolute inset-0 flex items-center justify-center px-4 text-center text-red-500'>
          {error}
        </div>
      )}
      {source.kind === 'none' && !modal && (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center'>
          <p className='text-lg text-neutral-300'>
            Build a graph from the topics you care about
          </p>
          <p className='text-sm text-neutral-500 max-w-sm'>
            Pick tags, domains and a date window, then explore how the
            matching papers relate.
          </p>
          <button
            type='button'
            onClick={() => setModal(NEW_GRAPH_MODAL)}
            className='mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#4ea8de] text-sm font-medium text-neutral-950 hover:bg-[#6bb8e6] cursor-pointer'
          >
            <Plus size={15} />
            Generate graph
          </button>
        </div>
      )}
      {source.kind === 'draft' && draftGraph && (
        <div className='fixed bottom-4 inset-x-0 z-10 flex justify-center pointer-events-none'>
          <div className='pointer-events-auto'>
            <DraftGraphBar
              // Remount per draft so a half-typed name doesn't carry over
              key={sourceKey}
              shown={draftGraph.nodes.length}
              total={draftGraph.meta.total ?? draftGraph.nodes.length}
              defaultName={defaultGraphName(
                source.filters,
                MAX_GRAPH_NAME_LENGTH,
              )}
              basedOnName={source.basedOn?.name}
              onSave={(name) => saveDraft(null, name)}
              onUpdate={() => saveDraft(source.basedOn)}
              onEdit={openEdit}
              onDiscard={discardDraft}
            />
          </div>
        </div>
      )}
      {modal && (
        <GenerateGraphModal
          // Remount per opening so the form re-seeds from initialFilters
          key={JSON.stringify(modal)}
          initialFilters={modal.initialFilters}
          mode={modal.mode}
          onGenerate={onGenerate}
          onClose={() => setModal(null)}
        />
      )}
      {data && width > 0 && height > 0 && (
        <ForceGraph2D<NodeCompact, LinkCompact>
          ref={fgRef}
          width={width}
          height={height}
          graphData={graphData}
          backgroundColor='#1a1a1a'
          nodeId='id'
          linkSource='s'
          linkTarget='t'
          cooldownTicks={data.meta.coords.included ? 0 : 90}
          autoPauseRedraw={!relatedLoading && !fading}
          onRenderFramePre={() => {
            // Capped: the first frame after an idle pause would otherwise see
            // a gap of seconds and snap straight to the target alpha.
            const now = performance.now()
            frameDt.current =
              lastFrameTs.current == null
                ? 0
                : Math.min(now - lastFrameTs.current, 32)
            lastFrameTs.current = now
          }}
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
              fitView(500)
              didAutoFit.current = true
            }
          }}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
          onBackgroundClick={onBackgroundClick}
        />
      )}

      {/* Overlays */}
      {/* Search results overlay flexes to fill the left column. */}
      <div className='fixed left-4 top-[72px] bottom-4 z-10 flex flex-col items-start justify-end gap-3 pointer-events-none'>
        {query && (searchResults.length > 0 || isSearching) && (
          <div className='flex-1 min-h-0 w-[360px] pointer-events-auto'>
            <SearchResultsOverlay
              results={searchResults}
              onSelect={onSearchPick}
              isLoading={isSearching}
              onAddToSubgraph={
                activeSavedGraph ? addToActiveSavedGraph : undefined
              }
              onRemoveFromSubgraph={
                activeSavedGraph ? removeFromActiveSavedGraph : undefined
              }
              subgraphPaperIds={
                activeSavedGraph
                  ? new Set(activeSavedGraph.paperIds)
                  : undefined
              }
              subgraphName={activeSavedGraph?.name}
            />
          </div>
        )}
        <div className='pointer-events-auto'>
          <GraphLegend />
        </div>
      </div>

      {selected && (
        <GraphPaperDetails
          paper={selected}
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
            track('paper_open', { view: 'graph', source: 'related' })
            setSelectedId(id)
            setLockedId(id)
            focusNodeById(id)
          }}
        />
      )}

      {/* Header: a single flex row so the groups shrink instead of overlapping.
          The search box absorbs the shrinking and secondary labels drop out
          at narrower breakpoints. It stays one row tall, which the overlays'
          top offsets rely on. */}
      <div className='fixed top-3 inset-x-4 z-10 flex items-center gap-3 pointer-events-none'>
        {/* Browse link + generate button + saved-graph controls */}
        <div className='shrink-0 flex items-center gap-2 pointer-events-auto'>
          <Link
            to='/browse'
            aria-label='Browse papers'
            className='flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-neutral-950 border border-neutral-700 hover:border-neutral-500 text-[13px] text-neutral-300 hover:text-white transition-colors'
          >
            <Library size={14} />
            Browse
          </Link>

          <button
            type='button'
            onClick={() => setModal(NEW_GRAPH_MODAL)}
            aria-label='Generate graph'
            className='flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-[#4ea8de] border border-[#4ea8de] text-[13px] font-medium text-neutral-950 hover:bg-[#6bb8e6] transition-colors'
          >
            <Plus size={14} />
            <span className='hidden lg:inline'>Generate graph</span>
          </button>

          <Dropdown
            className='max-w-[140px] lg:max-w-[240px]'
            label={
              source.kind === 'draft'
                ? 'Unsaved graph'
                : (activeSavedGraph?.name ??
                  (savedGraphs.length ? 'Saved graphs' : 'No saved graphs'))
            }
          >
            {savedGraphs.map((g) => (
              <button
                key={g.id}
                type='button'
                onClick={() => openSavedGraph(g)}
                title={g.name}
                className={`w-full truncate text-left px-4 py-2 text-sm hover:bg-[#333333] cursor-pointer transition-colors ${
                  activeSavedGraph?.id === g.id
                    ? 'text-[#4ea8de]'
                    : 'text-neutral-300'
                }`}
              >
                {g.name}
              </button>
            ))}
          </Dropdown>

          {pendingSavedGraph && (
            <div className='flex items-center gap-1.5 text-[13px] text-neutral-300 whitespace-nowrap'>
              Discard unsaved graph?
              {/* Keep first, as with Delete below */}
              <button
                type='button'
                onClick={() => setPendingSavedGraph(null)}
                className='px-2 py-0.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:text-white cursor-pointer'
              >
                Keep
              </button>
              <button
                type='button'
                onClick={() => {
                  track('graph_discard')
                  showSource({ kind: 'saved', graph: pendingSavedGraph })
                }}
                title={`Discard it and open “${pendingSavedGraph.name}”`}
                className='px-2 py-0.5 rounded-md border border-red-500/60 text-red-400 hover:text-red-300 hover:border-red-400 cursor-pointer'
              >
                Discard
              </button>
            </div>
          )}

          {activeSavedGraph &&
            (confirmingDelete ? (
              <div className='flex items-center gap-1.5 text-[13px] text-neutral-300 whitespace-nowrap'>
                Delete?
                {/* Keep comes first so it lands under the cursor that just
                    clicked the trash icon, making a double click harmless. */}
                <button
                  type='button'
                  onClick={() => setConfirmingDelete(false)}
                  className='px-2 py-0.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:text-white cursor-pointer'
                >
                  Keep
                </button>
                <button
                  type='button'
                  onClick={deleteActiveSavedGraph}
                  className='px-2 py-0.5 rounded-md border border-red-500/60 text-red-400 hover:text-red-300 hover:border-red-400 cursor-pointer'
                >
                  Delete
                </button>
              </div>
            ) : (
              <>
                <button
                  type='button'
                  onClick={openEdit}
                  aria-label={`Edit “${activeSavedGraph.name}”`}
                  title='Edit graph filters'
                  className='p-1.5 rounded-md bg-neutral-950 border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 cursor-pointer transition-colors'
                >
                  <Pencil size={14} />
                </button>
                <button
                  type='button'
                  onClick={() => setConfirmingDelete(true)}
                  aria-label={`Delete “${activeSavedGraph.name}”`}
                  title='Delete graph'
                  className='p-1.5 rounded-md bg-neutral-950 border border-neutral-700 text-neutral-300 hover:text-red-400 hover:border-neutral-500 cursor-pointer transition-colors'
                >
                  <Trash2 size={14} />
                </button>
              </>
            ))}
        </div>

        {/* Search bar */}
        <div className='flex-1 min-w-0 flex justify-center'>
          <div className='w-full min-w-0 flex items-center justify-center gap-2 pointer-events-auto'>
            <div className='flex-1 min-w-0 max-w-[550px] bg-[#2a2a2a] backdrop-blur-xs rounded-md'>
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
                    className='w-full pl-9 pr-3 lg:pr-20 py-1 rounded-md bg-neutral-900 border border-[#333333] text-[#e5e5e5] placeholder-[#666666] outline-none focus:ring-2 focus:ring-[#4ea8de]'
                  />
                  <div className='absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 text-[11px] text-neutral-400 pointer-events-none select-none'>
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
                    <span className='hidden lg:flex items-center gap-2'>
                      <kbd className='px-1.5 py-0.5 rounded bg-transparent border border-neutral-600 text-[11px] font-mono'>
                        Ctrl
                      </kbd>
                      <kbd className='px-1.5 py-0.5 rounded bg-transparent border border-neutral-600 text-[11px] font-mono'>
                        Del
                      </kbd>
                    </span>
                  </button>
                )}
              </div>
            </div>
            {semanticSearchEnabled && (
              <>
                <button
                  type='button'
                  aria-pressed={searchMode === 'semantic'}
                  title={
                    searchMode === 'semantic'
                      ? 'Semantic search on'
                      : 'Semantic search off'
                  }
                  onClick={() => {
                    const next =
                      searchMode === 'semantic' ? 'keyword' : 'semantic'
                    track('search_mode', { mode: next })
                    setSearchMode(next)
                  }}
                  className={`shrink-0 px-2 py-1 rounded-md bg-neutral-950 border cursor-pointer transition-colors ${
                    searchMode === 'semantic'
                      ? 'border-[#4ea8de] text-[#4ea8de]'
                      : 'border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white'
                  }`}
                >
                  <Sparkles size={15} />
                </button>
                <span
                  className={`hidden xl:inline shrink-0 text-[13px] whitespace-nowrap transition-colors ${searchMode === 'semantic' ? 'text-[#4ea8de]' : 'text-neutral-500'}`}
                >
                  {searchMode === 'semantic'
                    ? 'semantic search on'
                    : 'semantic search off'}
                </span>
              </>
            )}
          </div>
        </div>

        <div className='shrink-0 flex items-center gap-4 xl:gap-10 pointer-events-auto'>
          <Link
            to='/about'
            className='flex items-center gap-1.5 cursor-pointer text-[13px] text-neutral-300 hover:text-white underline underline-offset-2 transition-colors'
          >
            <Info size={14} />
            About
          </Link>
          <LatestBatchBadge className='hidden lg:inline' />
          <a
            target='_blank'
            href='https://github.com/ai-safety-graph/alignment-graph'
          >
            <img
              src='/ag-logo.svg'
              alt='Alignment Graph Logo'
              className='h-[34px] w-auto opacity-50 saturate-70'
            />
          </a>
        </div>
      </div>
    </div>
  )
}
