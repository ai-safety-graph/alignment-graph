import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import StatsPaperDetails from './StatsPaperDetails'
import MobilePaperDetails from './MobilePaperDetails'
import PaperList from './PaperList'
import { getSavedGraph, updateSavedGraph } from '../lib/storage'
import type { NodeCompact } from '../lib/types'
import { useClusterCatalog } from '../hooks/useClusterCatalog'
import { usePaperDetail } from '../hooks/usePaperDetail'
import { useRelatedPapers } from '../hooks/useRelatedPapers'
import { useNavHistory } from '../hooks/useNavHistory'

export default function SubgraphView() {
  const { id } = useParams<{ id: string }>()
  const { clusters, isLoading: clustersLoading } = useClusterCatalog()

  const [graphName, setGraphName] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeCompact[] | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    const graph = getSavedGraph(id)
    if (!graph) {
      setNotFound(true)
      return
    }
    setGraphName(graph.name)
    let alive = true
    ;(async () => {
      try {
        const { fetchSubgraph } = await import('../lib/api')
        const data = await fetchSubgraph(graph.paperIds)
        if (alive) setNodes(data.nodes)
      } catch {
        if (alive) setNodes([])
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  const removeFromSubgraph = (aid: string) => {
    if (!id) return
    setNodes((prev) => {
      const next = (prev ?? []).filter((n) => n.aid !== aid)
      updateSavedGraph(id, { paperIds: next.map((n) => n.aid) })
      return next
    })
  }

  const {
    selectedId,
    navHistory,
    selectFromList,
    selectRelated,
    navigateTo,
    close,
  } = useNavHistory()

  const selected = usePaperDetail(selectedId)
  const { neighbors, loading: neighborsLoading } = useRelatedPapers(selectedId)

  const items = useMemo(() => (nodes ?? []).map((n) => ({ n })), [nodes])
  const subgraphPaperIds = useMemo(
    () => new Set((nodes ?? []).map((n) => n.aid)),
    [nodes],
  )

  const handleSelectRelated = (aid: string) =>
    selectRelated(
      selected ? { aid: selected.aid, title: selected.t } : null,
      aid,
    )

  const backLink = (
    <Link
      to='/stats'
      className='shrink-0 p-2 rounded-full cursor-pointer bg-[#2a2a2a] border border-[#333333] text-neutral-400 hover:text-neutral-200'
      aria-label='Back to papers'
    >
      <ArrowLeft size={18} />
    </Link>
  )

  if (notFound) {
    return (
      <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col items-center justify-center gap-4'>
        <p className='text-neutral-400'>Graph not found.</p>
        <Link
          to='/stats'
          className='px-3 py-2 rounded-full bg-[#2a2a2a] border border-[#333333] text-sm text-neutral-300 hover:text-neutral-100'
        >
          Back to papers
        </Link>
      </div>
    )
  }

  return (
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div className='shrink-0 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur px-3 py-3 flex items-center gap-3'>
        {backLink}
        <div className='flex-1 min-w-0'>
          <div className='text-[15px] truncate'>{graphName ?? 'Graph'}</div>
          {nodes && (
            <div className='text-xs text-neutral-500'>
              {nodes.length} paper{nodes.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

      <div className='flex flex-row flex-1 overflow-hidden'>
        <div className='flex flex-col flex-1 overflow-hidden min-w-0'>
          <div className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-[#1a1a1a] scrollbar-track-transparent'>
            {!nodes && (
              <div className='flex h-[60vh] items-center justify-center text-neutral-400'>
                Loading…
              </div>
            )}

            {nodes && items.length === 0 && (
              <div className='p-6 text-center text-neutral-400'>
                No papers in this graph yet.
              </div>
            )}

            <PaperList
              items={items}
              clusters={clusters}
              clustersLoading={clustersLoading}
              onSelectId={selectFromList}
              enableHover
              selectedId={selectedId ?? undefined}
              onRemoveFromSubgraph={removeFromSubgraph}
              subgraphPaperIds={subgraphPaperIds}
              subgraphName={graphName ?? undefined}
            />
          </div>
        </div>

        <div className='hidden md:block w-1/2 border-l border-neutral-800 overflow-y-auto'>
          {selected ? (
            <StatsPaperDetails
              paper={selected}
              clusters={clusters}
              clustersLoading={clustersLoading}
              neighbors={neighbors}
              neighborsLoading={neighborsLoading}
              navHistory={navHistory}
              onClose={close}
              onSelectPaper={handleSelectRelated}
              onNavigateTo={navigateTo}
              onRemoveFromSubgraph={removeFromSubgraph}
              subgraphPaperIds={subgraphPaperIds}
              subgraphName={graphName ?? undefined}
            />
          ) : selectedId ? (
            <div className='p-6 space-y-3 animate-pulse'>
              <div className='h-3 bg-neutral-800 rounded w-1/3' />
              <div className='h-5 bg-neutral-800 rounded w-3/4' />
              <div className='h-5 bg-neutral-800 rounded w-1/2' />
            </div>
          ) : (
            <div className='flex h-full items-center justify-center text-neutral-500 text-sm'>
              Select a paper to load details
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className='md:hidden fixed inset-0 z-20 bg-black/70 flex items-center justify-center p-3'>
          <button
            aria-label='Close overlay'
            onClick={close}
            className='absolute inset-0'
          />
          <div className='relative z-10 w-full max-w-[720px] h-[92dvh] rounded-2xl shadow-2xl overflow-hidden'>
            <MobilePaperDetails
              paper={selected}
              clusters={clusters}
              clustersLoading={clustersLoading}
              neighbors={neighbors}
              neighborsLoading={neighborsLoading}
              navHistory={navHistory}
              onClose={close}
              onSelectPaper={handleSelectRelated}
              onNavigateTo={navigateTo}
            />
          </div>
        </div>
      )}
    </div>
  )
}
