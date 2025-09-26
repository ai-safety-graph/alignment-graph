import { Suspense, lazy } from 'react'
import { useMediaQuery } from './hooks/useMediaQuery'

const ArxivGraph = lazy(() => import('./components/ArxivGraph'))
const MobilePapers = lazy(() => import('./components/MobilePapers'))

export default function App() {
  const isSmall = useMediaQuery('(max-width: 768px)')
  if (isSmall === null) return <div className='h-screen bg-neutral-950' />

  return (
    <Suspense fallback={<div className='p-4 text-neutral-300'>Loading…</div>}>
      {isSmall ? (
        <MobilePapers src='/graph.json' />
      ) : (
        <ArxivGraph src='/graph.json' />
      )}
    </Suspense>
  )
}
