import { Suspense, lazy, useState } from 'react'
import { useMediaQuery } from './hooks/useMediaQuery'

const ArxivGraph = lazy(() => import('./components/Graph'))
const MobilePapers = lazy(() => import('./components/MobileView'))
const StatsPage = lazy(() => import('./components/StatsView'))

type View = 'graph' | 'stats'

export default function App() {
  const isSmall = useMediaQuery('(max-width: 768px)')
  const [view, setView] = useState<View>('graph')
  const toggleView = () => setView((v) => (v === 'graph' ? 'stats' : 'graph'))

  if (isSmall === null) return <div className='h-screen bg-neutral-950' />

  return (
    <Suspense
      fallback={
        <div className='flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-300'>
          Loading View...
        </div>
      }
    >
      {view === 'stats' ? (
        <StatsPage src='/graph.json' onToggleView={toggleView} />
      ) : isSmall ? (
        <MobilePapers src='/graph.json' onToggleView={toggleView} />
      ) : (
        <ArxivGraph src='/graph.json' onToggleView={toggleView} />
      )}
    </Suspense>
  )
}
