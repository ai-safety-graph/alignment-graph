import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useMediaQuery } from './hooks/useMediaQuery'
import LoadingIndicator from './components/LoadingIndicator'

const ArxivGraph = lazy(() => import('./components/GraphView'))
const StatsPage = lazy(() => import('./components/StatsView'))
const SubgraphPage = lazy(() => import('./components/SubgraphView'))

export default function App() {
  const isSmall = useMediaQuery('(max-width: 768px)')

  if (isSmall === null) return <div className='h-screen bg-neutral-950' />

  return (
    <Suspense
      fallback={
        <LoadingIndicator
          label='Loading view…'
          className='h-screen w-screen bg-neutral-950'
        />
      }
    >
      <Routes>
        <Route path='/' element={isSmall ? <StatsPage /> : <ArxivGraph />} />
        <Route path='/stats' element={<StatsPage />} />
        <Route path='/subgraph/:id' element={<SubgraphPage />} />
      </Routes>
    </Suspense>
  )
}
