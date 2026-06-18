import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useMediaQuery } from './hooks/useMediaQuery'

const ArxivGraph = lazy(() => import('./components/GraphView'))
const StatsPage = lazy(() => import('./components/StatsView'))

export default function App() {
  const isSmall = useMediaQuery('(max-width: 768px)')

  if (isSmall === null) return <div className='h-screen bg-neutral-950' />

  return (
    <Suspense
      fallback={
        <div className='flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-300'>
          Loading View...
        </div>
      }
    >
      <Routes>
        <Route path='/' element={isSmall ? <StatsPage /> : <ArxivGraph />} />
        <Route path='/stats' element={<StatsPage />} />
      </Routes>
    </Suspense>
  )
}
