import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
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
  NODE_RADIUS,
  nodeHitRadius,
  restoreClearance,
  PINNED_RING_COLOR,
  RELATED_GHOST_NODE_COLOR,
  SEARCH_GHOST_NODE_COLOR,
  stepAlpha,
  SUBGRAPH_NODE_COLOR,
} from '../lib/graph'
import type {
  GraphCursor,
  GraphDataCompact,
  LinkCompact,
  NodeCompact,
} from '../lib/types'
import type { RelatedPaper, SearchResult } from '../lib/api'
import {
  byUpdatedDesc,
  createSavedGraph,
  deleteSavedGraph,
  getActiveGraphId,
  getLegendCollapsed,
  listSavedGraphs,
  MAX_GRAPH_NAME_LENGTH,
  MAX_PINNED,
  setActiveGraphId,
  updateSavedGraph,
  withAdded,
  withRemoved,
} from '../lib/storage'
import type { GraphMembership, SavedGraph } from '../lib/storage'
import {
  defaultGraphName,
  EMPTY_FILTERS,
  filterLabels,
  filterSummary,
} from '../lib/graphFilters'
import type { GraphFilters } from '../lib/graphFilters'
import { GRAPH_PAGE_SIZE, pageLabel } from '../lib/graphContent'
import { graphPinsKey, useGraphContent } from '../hooks/useGraphContent'

import GraphLegend from './GraphLegend'
import GraphPaperDetails from './GraphPaperDetails'
import SearchResultsOverlay from './SearchResultsOverlay'
import Dropdown from './Dropdown'
import DraftGraphBar from './DraftGraphBar'
import GraphPager from './GraphPager'
import FilterChips from './FilterChips'
import GenerateGraphModal from './GenerateGraphModal'
import LoadingIndicator from './LoadingIndicator'
import { HeaderLogo, ViewSwitch } from './HeaderNav'
import { NewGraphButton, NewGraphMenuItem } from './NewGraph'
import { track } from '../lib/analytics'
import { useCapabilities } from '../hooks/useCapabilities'

// Alpha of nodes outside the active node's neighbourhood: softer while
// hovering, stronger once a node is locked. Changes fade over FADE_MS.
const DIM_ALPHA_HOVER = 0.3
const DIM_ALPHA_LOCKED = 0.15
const FADE_MS = 150

const SINGLE_NODE_ZOOM = 3
// Ticks the layout runs before freezing. Measured on a month of real layout
// (~1,300 nodes) with the anchored forces at the earlier 10-unit spacing: 100
// ticks left no overlapping pairs and landed within 2px of a 200-tick run;
// below ~75 overlaps survived. Not re-measured at the current spacing.
const COOLDOWN_TICKS = 100

// Ghost ids live in their own ranges, above any graph node's id (graphs have
// at most a page plus MAX_PINNED nodes), so they never collide with the
// nodes of whichever graph or page is shown next.
const SEARCH_GHOST_ID_BASE = 1_000_000
const RELATED_GHOST_ID_BASE = 2_000_000

// A node once it's in the force simulation: always has a live x/y position,
// an anchor (ax, ay) the anchored layout pulls it back toward (its stored
// layout coord), and fx/fy once the simulation has settled and frozen it.
type SimNode = NodeCompact & {
  x: number
  y: number
  ax: number
  ay: number
  fx?: number
  fy?: number
}

// Where each paper is in the layout shown, by aid (ids are renumbered per
// response), read whenever a node is built: a node rebuilt by a pin, hide or
// ghost refresh, including a paper switching between ghost and graph node,
// keeps its position instead of settling again. `live` is the nodes on the
// canvas (the simulation mutates them, so they're always current); `left` the
// last position of papers that left it. A paper coming back is frozen there
// again if the spot is still free (no node within restoreClearance of it),
// else unfrozen so collide can move it off the node that has taken the spot
// since. Kept outside the component so leaving the view (e.g. for /browse)
// and coming back keeps the layout too.
// `restored` holds the papers frozen back onto their `left` spot since the
// last sync, so papers returning in the same batch (e.g. one search's
// ghosts) are checked against each other too.
const layoutMemory: {
  key: string
  live: Map<string, SimNode>
  left: Map<string, { x: number; y: number }>
  restored: Map<string, { x: number; y: number }>
} = { key: '', live: new Map(), left: new Map(), restored: new Map() }

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
// (`basedOn` = the saved graph it was edited from), or a saved graph. Drafts
// carry their own pins and hides, which saving stores with the recipe.
type GraphSource =
  | { kind: 'none' }
  | ({
      kind: 'draft'
      filters: GraphFilters
      basedOn: SavedGraph | null
    } & GraphMembership)
  | { kind: 'saved'; graph: SavedGraph }

const NO_MEMBERSHIP: GraphMembership = { pinned: [], hidden: [] }

// Identifies the graph being shown, and with the page, the camera framing
function graphSourceKey(source: GraphSource) {
  return source.kind === 'draft'
    ? `draft:${JSON.stringify(source.filters)}`
    : source.kind === 'saved'
      ? `saved:${source.graph.id}`
      : 'none'
}

// Holds a bottom bar centred on the window, clear of the side overlays. The
// spacers grow equally from nothing, so the bar sits in the middle until one
// would get narrower than its clearance (px); that one then holds its width
// and the bar moves over only as far as it needs to, then shrinks or wraps.
function BottomBarSlot({
  left,
  right,
  children,
}: {
  left: number
  right: number
  children: ReactNode
}) {
  return (
    <div className='fixed bottom-4 inset-x-0 z-10 flex pointer-events-none'>
      <div aria-hidden className='grow basis-0' style={{ minWidth: left }} />
      {children}
      <div aria-hidden className='grow basis-0' style={{ minWidth: right }} />
    </div>
  )
}

type ModalState = {
  mode: 'generate' | 'edit'
  initialFilters: GraphFilters
  basedOn: SavedGraph | null
}

// Routes the header links leave the graph view for, with the "Discard"
// tooltip shown when that drops an open draft
const EXIT_ROUTES = {
  '/browse': 'Discard it and browse papers',
  '/about': 'Discard it and open About',
} as const
type ExitRoute = keyof typeof EXIT_ROUTES

const NEW_GRAPH_MODAL: ModalState = {
  mode: 'generate',
  initialFilters: EMPTY_FILTERS,
  basedOn: null,
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
  // Returning visitors land on the graph last opened in either view (else the
  // most recently updated one); first visitors get the new-graph modal.
  const [source, setSource] = useState<GraphSource>(() => {
    const active = getActiveGraphId()
    const graph = savedGraphs.find((g) => g.id === active) ?? savedGraphs[0]
    return graph ? { kind: 'saved', graph } : { kind: 'none' }
  })
  const [modal, setModal] = useState<ModalState | null>(() =>
    savedGraphs.length ? null : NEW_GRAPH_MODAL,
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Mirrors GraphLegend's own state, to keep the bottom bar clear of it
  const [legendCollapsed, setLegendCollapsed] = useState(getLegendCollapsed)
  // Where the user asked to go while a draft is open (a saved graph or
  // another route), waiting on "discard the draft?"
  const [pendingExit, setPendingExit] = useState<SavedGraph | ExitRoute | null>(
    null,
  )
  const navigate = useNavigate()
  const activeSavedGraph = source.kind === 'saved' ? source.graph : null
  const setActiveSavedGraph = (graph: SavedGraph) =>
    setSource({ kind: 'saved', graph })

  // The opening source when no active graph was stored and the view fell back
  // to the most recent one. That fallback isn't a choice, so it isn't stored:
  // Browse keeps showing all papers until the user picks a graph.
  const [fallbackSource] = useState(() =>
    savedGraphs.some((g) => g.id === getActiveGraphId()) ? null : source,
  )

  // Last saved graph shown, so discarding a draft can go back to it.
  // It's also the graph Browse opens on.
  const lastSavedIdRef = useRef<string | null>(activeSavedGraph?.id ?? null)
  useEffect(() => {
    if (source.kind !== 'saved') return
    lastSavedIdRef.current = source.graph.id
    if (source !== fallbackSource) setActiveGraphId(source.graph.id)
  }, [source, fallbackSource])

  const membership: GraphMembership | null =
    source.kind === 'draft'
      ? { pinned: source.pinned, hidden: source.hidden }
      : source.kind === 'saved'
        ? { pinned: source.graph.pinned, hidden: source.graph.hidden }
        : null
  const pinnedFull = (membership?.pinned.length ?? 0) >= MAX_PINNED

  const sourceKey = graphSourceKey(source)

  // Cursors for the pages after the first, newest first. Tied to the source
  // they were collected on, and cleared by showSource, so switching graphs
  // (or coming back to one whose filters were updated) starts at page 1.
  // Pins and hides on the graph shown keep the page.
  const [paging, setPaging] = useState<{
    key: string
    cursors: GraphCursor[]
  }>({ key: sourceKey, cursors: [] })
  const cursors = paging.key === sourceKey ? paging.cursors : []
  const pageIndex = cursors.length

  // "Show only pinned papers", from the bottom bar's pinned count: the source
  // key it was turned on for. Cleared when switching graphs (showSource),
  // carried over when a draft is saved, and kept by paging, pins and hides.
  const [pinnedOnlyKey, setPinnedOnlyKey] = useState<string | null>(null)
  // Bumped to frame the canvas after the visible nodes change (see fitView)
  const [fitRequest, setFitRequest] = useState(0)

  // The graph's papers: a page of its recipe plus its pins, minus hides.
  // Queries use the app-wide infinite staleTime, so revisiting a graph or
  // page (e.g. navigating to /browse and back) doesn't refetch.
  const content = useGraphContent(
    source.kind === 'none' || !membership
      ? null
      : {
          graphKey: source.kind === 'saved' ? source.graph.id : 'draft',
          filters:
            source.kind === 'draft'
              ? source.filters
              : (source.graph.filters ?? null),
          ...membership,
          cursor: cursors[cursors.length - 1] ?? null,
        },
  )
  const data = content.data
  const pageAids = content.pageAids

  const setMembership = (next: GraphMembership) => {
    if (source.kind === 'draft') {
      setSource({ ...source, ...next })
      return
    }
    if (source.kind !== 'saved') return
    // Add buttons are disabled at MAX_PINNED; the catch is a backstop so a
    // failed save never surfaces as an uncaught error
    let updated: SavedGraph
    try {
      updated = updateSavedGraph(source.graph.id, next)
    } catch {
      return
    }
    setSavedGraphs((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    )
    setActiveSavedGraph(updated)
  }

  const addToGraph = (aid: string) => {
    if (membership) setMembership(withAdded(membership, aid))
  }

  const removeFromGraph = (aid: string) => {
    if (membership) setMembership(withRemoved(membership, aid))
  }

  const error = content.error
    ? `Failed to ${source.kind === 'draft' ? 'generate' : 'load'} graph: ${content.error.message}`
    : null
  const showLoading = content.isLoading
  const isEmptySavedGraph = source.kind === 'saved' && content.isEmpty

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

  // A layout is a recipe's page (or a recipe-less graph), not a source, so
  // saving a draft (draft → saved, same recipe) keeps it. The requested one
  // runs ahead of the data while the next page loads (placeholder data), so
  // the layout shown only follows it when the data itself changes.
  const recipe =
    source.kind === 'draft'
      ? source.filters
      : source.kind === 'saved'
        ? source.graph.filters
        : null
  // The force mode is part of it: a pin without stored coords turns the whole
  // graph to the free layout (see useForceConfig), where nodes frozen at
  // their anchored positions would leave the new node alone against
  // forceCenter, so it lays out afresh instead.
  const requestedLayoutKey = `${
    recipe ? `recipe:${JSON.stringify(recipe)}` : sourceKey
  }#${pageIndex}${data && !data.meta.coords.included ? '#free' : ''}`
  // The force mode belongs to the layout shown too: data that changes while
  // a page change is in flight (e.g. a pin without coords landing first)
  // mustn't switch the forces under the layout's frozen nodes.
  const requestedAnchored = !!data?.meta.coords.included
  const shownLayoutRef = useRef({
    data,
    key: requestedLayoutKey,
    anchored: requestedAnchored,
  })
  if (shownLayoutRef.current.data !== data && !content.isPaging)
    shownLayoutRef.current = {
      data,
      key: requestedLayoutKey,
      anchored: requestedAnchored,
    }
  const layoutKey = shownLayoutRef.current.key
  const anchored = shownLayoutRef.current.anchored

  // Build a simulation node anchored at (ax, ay): its stored coord. It starts
  // there, or where it is or was in this layout (see layoutMemory); the live
  // simulation separates overlaps (see useForceConfig) and freezes nodes once
  // it settles (onEngineStop).
  const layoutKeyRef = useRef(layoutKey)
  layoutKeyRef.current = layoutKey
  const anchoredRef = useRef(anchored)
  anchoredRef.current = anchored
  const toSimNode = useCallback(
    <N extends NodeCompact>(n: N, ax: number, ay: number): N & SimNode => {
      const node: N & SimNode = {
        ...n,
        ax,
        ay,
        x: ax,
        y: ay,
        fx: undefined,
        fy: undefined,
      }
      if (layoutMemory.key !== layoutKeyRef.current) return node
      const live = layoutMemory.live.get(n.aid)
      if (live)
        return { ...node, x: live.x, y: live.y, fx: live.fx, fy: live.fy }
      const left = layoutMemory.left.get(n.aid)
      if (!left) return node
      const overlaps = (o: { x: number; y: number }) =>
        Math.hypot(o.x - left.x, o.y - left.y) <
        restoreClearance(anchoredRef.current)
      let free = true
      for (const o of layoutMemory.live.values()) {
        if (overlaps(o)) {
          free = false
          break
        }
      }
      // Keyed by aid, so rebuilding the same node (StrictMode runs state
      // updaters twice) doesn't count as a clash with itself
      for (const [aid, o] of layoutMemory.restored) {
        if (!free) break
        if (aid !== n.aid && overlaps(o)) free = false
      }
      if (!free) return { ...node, ...left }
      layoutMemory.restored.set(n.aid, left)
      return { ...node, ...left, fx: left.x, fy: left.y }
    },
    [],
  )

  const simNodes = useMemo(() => {
    if (!data) return [] as SimNode[]
    return data.nodes.map((n) => toSimNode(n, n.x ?? 0, n.y ?? 0))
  }, [data, toSimNode])

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

  // Debounced backend search. Only fetches results; ghosts are built from
  // them below, against whichever graph is showing.
  const searchTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)

    if (!query.trim()) {
      setApiResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const { searchPapers, fetchPapers } = await import('../lib/api')
        let results: SearchResult[]
        if (searchMode === 'semantic') {
          const res = await searchPapers(query, { limit: 50 })
          results = res.results
        } else {
          const res = await fetchPapers({ q: query, limit: 50 })
          results = res.items.map((item, i) => ({ ...item, id: i, sim: null }))
        }
        setApiResults(results)
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

  // Search ghosts: results that aren't nodes of the shown graph. Rebuilt when
  // the results or the graph change (switch, page, pin, hide). Ghosts already
  // built keep their id, results that became real nodes drop out, and only
  // results with no ghost yet are fetched, so a pin costs no request.
  const nextSearchGhostId = useRef(SEARCH_GHOST_ID_BASE)
  useEffect(() => {
    // Wait for the graph, so ghosts aren't placed against an empty one
    if (!data) return
    const coords = data.meta.coords
    // New ghosts are anchored to their stored coord; the simulation
    // separates them from the already-frozen graph nodes.
    const place = (nodes: (NodeCompact & { id: number })[]): SimNode[] =>
      nodes.map((n) => {
        const { x: ax, y: ay } =
          coords.bounds && n.rx != null && n.ry != null
            ? ghostCoord(n.rx, n.ry, coords)
            : { x: n.x ?? 0, y: n.y ?? 0 }
        return toSimNode(n, ax, ay)
      })

    const inGraph = new Set(simNodes.map((n) => n.aid))
    const wanted = new Set(
      apiResults.map((r) => r.aid).filter((aid) => !inGraph.has(aid)),
    )
    // Kept ghosts keep their id. Placing them again keeps their live
    // position within the same layout (layoutMemory), and re-anchors them
    // against a new graph's coords after a layout change.
    const kept = place(
      ghostSimNodesRef.current.filter((g) => wanted.has(g.aid)),
    )
    for (const g of kept) wanted.delete(g.aid)
    setGhostSimNodes(kept)
    if (wanted.size === 0) return

    let alive = true
    ;(async () => {
      try {
        const { fetchSubgraph } = await import('../lib/api')
        const fetched = await fetchSubgraph([...wanted])
        if (!alive) return
        const fresh = fetched.nodes.map((n) => ({
          ...n,
          id: nextSearchGhostId.current++,
        }))
        setGhostSimNodes([...kept, ...place(fresh)])
      } catch {
        // Keep the ghosts we have
      }
    })()
    return () => {
      alive = false
    }
  }, [apiResults, simNodes, data, toSimNode])

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

  // Node ids are positions in the current response, so a pin, hide or ghost
  // rebuild can renumber the selected paper. Follow it by aid: remember the
  // aid when the selection changes, and re-find it when the nodes change.
  const selectedAidRef = useRef<string | null>(null)
  useEffect(() => {
    selectedAidRef.current =
      selectedId != null ? (byId.get(selectedId)?.aid ?? null) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  useEffect(() => {
    const aid = selectedAidRef.current
    if (aid == null || selectedId == null) return
    const id = aidToId.get(aid)
    if (id === selectedId) return
    if (id === undefined) {
      // Gone, e.g. the user just removed it from the graph
      setSelectedId(null)
      setLockedId(null)
      setHoverId(null)
      return
    }
    setSelectedId(id)
    setLockedId((locked) => (locked == null ? null : id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aidToId])

  // Build ghost nodes for a selected paper's related papers, positioned in the
  // main graph's coordinate space. Replaces the previous related-ghost set,
  // reusing the ghosts (and ids) of papers still in it, such as the selected
  // node itself if it is a related ghost, so a rebuild (pin, hide) doesn't
  // move them.
  const nextRelatedGhostId = useRef(RELATED_GHOST_ID_BASE)
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

      setRelatedGhostNodes((prev) => {
        const wanted = new Set(results.map((r) => r.aid))
        const retained = prev.filter(
          (n) =>
            n.id === sel.id || (wanted.has(n.aid) && !existingAids.has(n.aid)),
        )
        const seenAids = new Set(retained.map((n) => n.aid))
        const fresh: RelatedPaper[] = []
        for (const r of results) {
          if (r.rx == null || r.ry == null) continue
          if (r.aid === sel.aid) continue
          if (existingAids.has(r.aid) || seenAids.has(r.aid)) continue
          seenAids.add(r.aid)
          fresh.push(r)
        }
        // Anchored at their stored coord; the simulation separates them
        const built = retained.slice()
        fresh.forEach((r) => {
          const { x, y } = ghostCoord(r.rx!, r.ry!, coords)
          const node: NodeCompact = {
            id: nextRelatedGhostId.current++,
            aid: r.aid,
            t: r.t,
            au: r.au,
            pd: r.pd,
            dm: r.dm,
            ln: r.ln,
            tags: r.tags,
            pr: r.pr,
            vn: r.vn,
          }
          built.push(toSimNode(node, x, y))
        })
        return built
      })
    },
    [data, toSimNode],
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
  // The canvas first mounts once the graph has fully loaded: `data` is
  // already set when only one of its queries (page or pins) has returned, and
  // the first tick would frame just those nodes. After that it stays mounted
  // for the source: pinning the first paper starts a pins query with no
  // placeholder, and unmounting then would drop the camera framing.
  // Forces are configured only once it's mounted: on a remount with cached
  // data the first render has no width yet, so fgRef is still unset, and
  // configuring then would leave force-graph's default forces.
  // Cleared as soon as another source renders unloaded, so coming back to a
  // source that is reloading waits for it again.
  const loadedSourceRef = useRef<string | null>(null)
  if (data && !showLoading) loadedSourceRef.current = sourceKey
  else if (loadedSourceRef.current !== sourceKey) loadedSourceRef.current = null
  const canvasReady =
    !!data &&
    (!showLoading || loadedSourceRef.current === sourceKey) &&
    width > 0 &&
    height > 0
  useForceConfig(fgRef, canvasReady, anchored)

  // Autofit when new content arrives for another graph source or page: pages
  // of a broad recipe can sit in different parts of the map, and graphs
  // sharing a recipe can have pins anywhere. When the source changes but the
  // content doesn't (saving a draft, or editing a recipe without changing
  // it), the framing carries over to the new source. Not while the previous
  // page stands in for the next one. Also refit whenever the canvas mounts
  // afresh (e.g. switching to a graph that loads), since it starts at the
  // default camera.
  const didAutoFit = useRef(false)
  const framedRef = useRef({ data, sourceKey, layoutKey: requestedLayoutKey })
  useEffect(() => {
    if (content.isPaging) return
    const prev = framedRef.current
    framedRef.current = { data, sourceKey, layoutKey: requestedLayoutKey }
    if (prev.data === data) return
    if (prev.sourceKey !== sourceKey || prev.layoutKey !== requestedLayoutKey)
      didAutoFit.current = false
  }, [data, sourceKey, requestedLayoutKey, content.isPaging])
  useEffect(() => {
    if (!canvasReady) didAutoFit.current = false
  }, [canvasReady])

  // ESC unlock (global). Off while the modal is open, which handles its own Esc.
  useEffect(() => {
    if (modal) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLockedId(null)
        setHoverId(null)
        setSelectedId(null)
        fitView(400)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [modal])

  // Fit the camera to the rendered nodes. Read through a ref so the ESC
  // handler's closure never fits against stale nodes or viewport size.
  // A lone node gets a fixed zoom: zoomToFit sizes the view to its tiny bbox,
  // which zooms in absurdly far, or (with padding > half the viewport) goes
  // negative and clamps to ~0, leaving nothing visible.
  const fitStateRef = useRef<{
    nodes: SimNode[]
    width: number
    height: number
  }>({ nodes: [], width: 0, height: 0 })
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
  // Runs after the render that updated fitStateRef, so it frames the nodes
  // left visible (e.g. by the pinned-only toggle)
  useEffect(() => {
    if (fitRequest > 0) fitView(500)
  }, [fitRequest])

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

  // Hover handling
  const hoverTimer = useRef<number | null>(null)
  const onNodeHover = (node: NodeObject<NodeCompact> | null) => {
    if (node && !isInteractive(node.id)) {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
      hoverTimer.current = window.setTimeout(() => setHoverId(null), 120)
      return
    }
    if (lockedId != null) return
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
    focusNode(node as SimNode)
  }

  const onBackgroundClick = () => {
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
    setPendingExit(null)
    setPaging({ key: '', cursors: [] })
    // Regenerating a draft with the same filters keeps the source key and the
    // data, so no autofit runs: frame the papers pinned-only hid. Any other
    // change autofits by itself, or (saving a draft) keeps the framing.
    if (pinnedOnlyKey != null && graphSourceKey(next) === sourceKey)
      setFitRequest((r) => r + 1)
    setPinnedOnlyKey(null)
    setSource(next)
  }

  // Opening a saved graph drops an open draft, so confirm that first
  const openSavedGraph = (graph: SavedGraph) => {
    if (source.kind === 'draft') setPendingExit(graph)
    else showSource({ kind: 'saved', graph })
  }

  const confirmExit = () => {
    if (!pendingExit) return
    track('graph_discard')
    if (typeof pendingExit === 'string') navigate(pendingExit)
    else showSource({ kind: 'saved', graph: pendingExit })
  }

  // Leaving the graph view drops an open draft, so a header link confirms
  // first. Opening the link in a new tab (modifier click) leaves it alone.
  const confirmLeaveTo = (to: ExitRoute) => (e: React.MouseEvent) => {
    const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
    if (source.kind !== 'draft' || modified) return
    e.preventDefault()
    setPendingExit(to)
  }

  const onGenerate = (filters: GraphFilters) => {
    track('graph_generate', {
      tags: filters.tags.length,
      domains: filters.domains.length,
      date: filters.datePreset,
      peer_reviewed: filters.peerReviewed ?? false,
      mode: modal?.mode ?? 'generate',
    })
    // Editing keeps the papers added or removed by hand: the draft's own, or
    // those of the saved graph being edited
    const kept: GraphMembership =
      modal?.mode !== 'edit'
        ? NO_MEMBERSHIP
        : source.kind === 'draft'
          ? { pinned: source.pinned, hidden: source.hidden }
          : modal.basedOn
            ? { pinned: modal.basedOn.pinned, hidden: modal.basedOn.hidden }
            : NO_MEMBERSHIP
    showSource({
      kind: 'draft',
      filters,
      basedOn: modal?.basedOn ?? null,
      ...kept,
    })
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

  // Stores the draft (recipe, pins and hides) and switches to it as a saved
  // graph. Its recipe page is cached under the same key either way, and its
  // pins are seeded under the saved graph's key, so saving doesn't refetch.
  const saveDraft = (target: SavedGraph | null, name?: string) => {
    if (source.kind !== 'draft' || !data) return 'Graph not loaded yet'
    const stored = {
      filters: source.filters,
      pinned: source.pinned,
      hidden: source.hidden,
    }
    let saved: SavedGraph
    try {
      saved = target
        ? updateSavedGraph(target.id, stored)
        : createSavedGraph(name!, stored)
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save graph'
    }
    track('graph_save', { kind: target ? 'update' : 'new' })
    const pins = queryClient.getQueryData(graphPinsKey('draft', source.pinned))
    if (pins)
      queryClient.setQueryData(graphPinsKey(saved.id, saved.pinned), pins)
    setSavedGraphs((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)])
    showSource({ kind: 'saved', graph: saved })
    // Same papers on screen, so keep pinned-only on (after showSource's reset)
    if (pinnedOnly) setPinnedOnlyKey(`saved:${saved.id}`)
    return null
  }

  // Paging drops the selection: its paper may not be on the next page
  const goOlder = () => {
    const next = data?.meta.next
    if (!next || content.isPaging) return
    track('graph_page', { direction: 'older' })
    clearSelection()
    setPaging({ key: sourceKey, cursors: [...cursors, next] })
  }

  const goNewer = () => {
    if (pageIndex === 0) return
    track('graph_page', { direction: 'newer' })
    clearSelection()
    setPaging({ key: sourceKey, cursors: cursors.slice(0, -1) })
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

  // Keep layoutMemory in step with the canvas (see its comment)
  useEffect(() => {
    const m = layoutMemory
    if (m.key !== layoutKey) {
      m.key = layoutKey
      m.live = new Map()
      m.left = new Map()
    }
    m.restored = new Map()
    const live = new Map(allSimNodes.map((n) => [n.aid, n]))
    for (const [aid, n] of m.live)
      if (!live.has(aid)) m.left.set(aid, { x: n.x, y: n.y })
    for (const aid of live.keys()) m.left.delete(aid)
    m.live = live
  }, [allSimNodes, layoutKey])

  const graphData = useMemo(
    () => ({ nodes: allSimNodes, links: data?.links ?? [] }),
    [allSimNodes, data],
  )
  // Pinned papers get a ring and an Unpin button; the recipe's own matches
  // can be pinned too
  const pinnedAids = useMemo(
    () => new Set(membership?.pinned ?? []),
    [membership?.pinned],
  )

  // Pins on screen, on this page of the recipe or not. A graph without a
  // recipe is all pins, which the count already says, so it has no toggle.
  const hasRecipe = source.kind === 'draft' || !!activeSavedGraph?.filters
  const pinnedShown =
    data && hasRecipe
      ? data.nodes.filter((n) => pinnedAids.has(n.aid)).length
      : 0
  const pinnedOnly = pinnedOnlyKey === sourceKey && pinnedShown > 0
  // Once nothing pinned is left to show (the last pin unpinned), turn it off
  // for good, so pinning again doesn't hide everything else, and frame the
  // papers that came back
  useEffect(() => {
    if (!data || pinnedOnlyKey !== sourceKey || pinnedShown > 0) return
    setPinnedOnlyKey(null)
    setFitRequest((r) => r + 1)
  }, [data, pinnedOnlyKey, sourceKey, pinnedShown])
  // Pinned-only hides the recipe's other papers but keeps them in the
  // simulation, so the layout doesn't move. Pins and search ghosts stay, and
  // the camera frames them. The selected paper (e.g. one just unpinned or
  // picked from search) and its related papers also stay, including related
  // papers that are hidden recipe nodes and so have no ghost, but only while
  // it's selected, so fits leave them out.
  const relatedAids = useMemo(
    () => new Set(related.map((r) => r.aid)),
    [related],
  )
  const isFramedNode = (n: NodeCompact) =>
    !pinnedOnly || ghostIds.has(n.id) || pinnedAids.has(n.aid)
  const isNodeVisible = (n: NodeCompact) =>
    isFramedNode(n) || n.id === selectedId || relatedAids.has(n.aid)
  const togglePinnedOnly = () => {
    track('graph_pinned_only', { value: pinnedOnly ? 'off' : 'on' })
    setPinnedOnlyKey(pinnedOnly ? null : sourceKey)
    setFitRequest((r) => r + 1)
  }

  // Related ghosts are excluded: every fit (ESC / background click) also
  // deselects, which clears them right after, so fitting to them would frame
  // nodes that are about to vanish.
  fitStateRef.current = {
    nodes: allSimNodes
      .slice(0, allSimNodes.length - relatedGhostNodes.length)
      .filter(isFramedNode),
    width,
    height,
  }

  // Count, date span and Newer/Older for the bottom bar. Without a recipe
  // every node is a pin, and there's one page.
  const recipeShown = data
    ? hasRecipe
      ? data.nodes.filter((n) => pageAids.has(n.aid)).length
      : data.nodes.length
    : 0
  const pager = data && (
    <GraphPager
      label={pageLabel({
        pageIndex,
        pageSize: GRAPH_PAGE_SIZE,
        shown: recipeShown,
        total: hasRecipe ? (data.meta.total ?? recipeShown) : recipeShown,
        span: data.meta.span,
      })}
      pinned={pinnedShown}
      pinnedOnly={pinnedOnly}
      onTogglePinnedOnly={togglePinnedOnly}
      paged={pageIndex > 0 || !!data.meta.next}
      canNewer={pageIndex > 0}
      canOlder={!!data.meta.next && !content.isPaging}
      onNewer={goNewer}
      onOlder={goOlder}
    />
  )
  const graphName = activeSavedGraph?.name ?? 'Unsaved graph'

  // The bottom bar stays centred on the window (BottomBarSlot); these are
  // only how much room it leaves the side overlays: the Legend (its button,
  // or the 280px card while expanded) or the search results column (360px at
  // left-4, which holds the Legend too) on the left, and the paper details
  // panel (440px at right-4, GraphPaperDetails) while one is open. When both
  // are open on a narrow screen there's no room left, and the overlays draw
  // over it.
  const showSearchResults = !!query && (searchResults.length > 0 || isSearching)
  const bottomBarLeft = showSearchResults ? 392 : legendCollapsed ? 112 : 312
  const bottomBarRight = selected ? 472 : 112

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
    if (!ghostIds.has(n.id) && pinnedAids.has(n.aid)) {
      ctx.beginPath()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = PINNED_RING_COLOR
      ctx.arc(n.x, n.y, r + 2, 0, 2 * Math.PI, false)
      ctx.stroke()
    }
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
            Search for papers above and use &ldquo;Pin to graph&rdquo; to start
            building it out.
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
            Pick tags, domains and a date window, then explore how the matching
            papers relate.
          </p>
          <button
            type='button'
            onClick={() => setModal(NEW_GRAPH_MODAL)}
            className='mt-1 flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md border border-[#4ea8de]/50 bg-[#4ea8de]/15 text-sm font-medium text-[#8cc8ee] hover:bg-[#4ea8de]/25 hover:border-[#4ea8de]/70 hover:text-[#b3dbf5] cursor-pointer transition-colors'
          >
            <Plus size={15} />
            New graph
          </button>
        </div>
      )}
      {source.kind === 'draft' && data && (
        <BottomBarSlot left={bottomBarLeft} right={bottomBarRight}>
          <div className='pointer-events-auto min-w-0'>
            <DraftGraphBar
              // Remount per draft so a half-typed name doesn't carry over
              key={sourceKey}
              pager={pager}
              empty={data.nodes.length === 0}
              defaultName={defaultGraphName(
                source.filters,
                MAX_GRAPH_NAME_LENGTH,
              )}
              basedOnName={source.basedOn?.name}
              chips={filterSummary(source.filters)}
              chipsTitle={filterLabels(source.filters).join(', ')}
              onSave={(name) => saveDraft(null, name)}
              onUpdate={() => saveDraft(source.basedOn)}
              onEdit={openEdit}
              onDiscard={discardDraft}
            />
          </div>
        </BottomBarSlot>
      )}
      {/* Shown even with nothing loaded (an emptied pins-only graph, a
          failed fetch), so the graph can still be edited or deleted */}
      {source.kind === 'saved' && (
        <BottomBarSlot left={bottomBarLeft} right={bottomBarRight}>
          {/* The graph's count, its recipe and what can be done with it, as
              on the list view's count line */}
          <div className='pointer-events-auto min-w-0 max-w-[56rem] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-950/95 shadow-lg'>
            {pager}
            {source.graph.filters && (
              <FilterChips
                labels={filterSummary(source.graph.filters)}
                title={filterLabels(source.graph.filters).join(', ')}
                className='grow basis-0 min-w-28'
              />
            )}
            {confirmingDelete ? (
              <span className='shrink-0 flex items-center gap-1.5 text-[13px] text-neutral-300 whitespace-nowrap'>
                Delete this graph?
                {/* Keep comes first so it lands under the cursor that just
                    clicked Delete, making a double click harmless */}
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
              </span>
            ) : (
              <span className='shrink-0 flex items-center gap-3 text-xs'>
                <button
                  type='button'
                  onClick={openEdit}
                  className='flex items-center gap-1 text-neutral-500 hover:text-white underline underline-offset-2 cursor-pointer'
                >
                  <Pencil size={11} />
                  {source.graph.filters ? 'Edit' : 'Add filters'}
                </button>
                <button
                  type='button'
                  onClick={() => setConfirmingDelete(true)}
                  className='flex items-center gap-1 text-neutral-500 hover:text-red-400 underline underline-offset-2 cursor-pointer'
                >
                  <Trash2 size={11} />
                  Delete
                </button>
              </span>
            )}
            {/* Starting another graph doesn't act on this one, so it sits
                apart from Edit/Delete */}
            <span
              aria-hidden
              className='shrink-0 h-4 border-l border-neutral-700'
            />
            <button
              type='button'
              onClick={() => setModal(NEW_GRAPH_MODAL)}
              className='shrink-0 flex items-center gap-1 whitespace-nowrap text-xs text-[#4ea8de] hover:text-[#6bb8e6] underline underline-offset-2 cursor-pointer'
            >
              <Plus size={11} />
              New graph
            </button>
          </div>
        </BottomBarSlot>
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
      {canvasReady && (
        <ForceGraph2D<NodeCompact, LinkCompact>
          ref={fgRef}
          width={width}
          height={height}
          graphData={graphData}
          backgroundColor='#1a1a1a'
          nodeId='id'
          linkSource='s'
          linkTarget='t'
          cooldownTicks={COOLDOWN_TICKS}
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
          nodeVisibility={(n: NodeObject<NodeCompact>) => isNodeVisible(n)}
          nodeLabel={nodeLabel}
          linkColor={linkColor}
          nodePointerAreaPaint={(n: NodeObject<NodeCompact>, color, ctx) => {
            if (!isInteractive(n.id)) return
            ctx.fillStyle = color
            ctx.beginPath()
            // No wider than half the node spacing: the pointer canvas picks
            // the last area painted, so wider areas overlapping neighbours
            // would bury nodes in dense clusters under the ones around them
            ctx.arc(n.x ?? 0, n.y ?? 0, nodeHitRadius(anchored), 0, 2 * Math.PI)
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
          onEngineTick={() => {
            // With stored coords, nodes settle within a few px of where they
            // start, so frame them on the first tick: they spread apart in
            // place instead of the camera jumping once they've settled.
            if (!didAutoFit.current && anchored) {
              fitView(0)
              didAutoFit.current = true
            }
          }}
          onEngineStop={() => {
            // Freeze everything once settled, so the reheat each graphData
            // change triggers (search or related ghosts, pin, hide) only
            // moves the nodes added since.
            for (const n of allSimNodes) {
              if (n.fx == null) {
                n.fx = n.x
                n.fy = n.y
              }
            }
            // Without coords the layout grows from the origin, so it can
            // only be framed once it has settled
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
        {showSearchResults && (
          <div className='flex-1 min-h-0 w-[360px] pointer-events-auto'>
            <SearchResultsOverlay
              results={searchResults}
              onSelect={onSearchPick}
              isLoading={isSearching}
              onAddToSubgraph={membership ? addToGraph : undefined}
              onRemoveFromSubgraph={membership ? removeFromGraph : undefined}
              subgraphPaperIds={membership ? pinnedAids : undefined}
              subgraphName={graphName}
              subgraphFull={pinnedFull}
            />
          </div>
        )}
        <div className='pointer-events-auto'>
          <GraphLegend onCollapsedChange={setLegendCollapsed} />
        </div>
      </div>

      {selected && (
        <GraphPaperDetails
          paper={selected}
          related={related}
          relatedLoading={relatedLoading}
          onClose={onBackgroundClick}
          onAddToSubgraph={membership ? addToGraph : undefined}
          onRemoveFromSubgraph={membership ? removeFromGraph : undefined}
          subgraphPaperIds={membership ? pinnedAids : undefined}
          subgraphName={graphName}
          subgraphFull={pinnedFull}
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
        {/* Logo, then the graph picker and its controls. The two sides split
            the leftover width equally (but never below their content), which
            keeps the search centred; they stay click-through outside their
            controls so the canvas behind still gets clicks. */}
        <div className='flex-1 basis-0 min-w-fit pr-4 flex'>
          <div className='flex items-center gap-2 pointer-events-auto'>
            <HeaderLogo current='graph' />
            {/* A little more room after the logo than between controls */}
            <div aria-hidden className='w-1' />

            {/* Picking a graph and starting a new one share the dropdown;
              until there's something to pick, a button stands in */}
            {savedGraphs.length === 0 && source.kind !== 'draft' ? (
              <NewGraphButton onClick={() => setModal(NEW_GRAPH_MODAL)} />
            ) : (
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
                <NewGraphMenuItem onClick={() => setModal(NEW_GRAPH_MODAL)} />
              </Dropdown>
            )}

            {pendingExit && (
              <div className='flex items-center gap-1.5 text-[13px] text-neutral-300 whitespace-nowrap'>
                Discard unsaved graph?
                {/* Keep first, as with the bottom bar's Delete confirm */}
                <button
                  type='button'
                  onClick={() => setPendingExit(null)}
                  className='px-2 py-0.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:text-white cursor-pointer'
                >
                  Keep
                </button>
                <button
                  type='button'
                  onClick={confirmExit}
                  title={
                    typeof pendingExit === 'string'
                      ? EXIT_ROUTES[pendingExit]
                      : `Discard it and open “${pendingExit.name}”`
                  }
                  className='px-2 py-0.5 rounded-md border border-red-500/60 text-red-400 hover:text-red-300 hover:border-red-400 cursor-pointer'
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search bar */}
        <div className='flex-[0_1_42rem] min-w-0 flex justify-center'>
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

        <div className='flex-1 basis-0 min-w-fit pl-4 flex justify-end'>
          <div className='flex items-center gap-4 xl:gap-10 pointer-events-auto'>
            <ViewSwitch current='graph' onLeave={confirmLeaveTo('/browse')} />
            <Link
              to='/about'
              onClick={confirmLeaveTo('/about')}
              className='flex items-center gap-1.5 cursor-pointer text-[13px] text-neutral-300 hover:text-white underline underline-offset-2 transition-colors'
            >
              <Info size={14} />
              About
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
