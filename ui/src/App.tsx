import { Suspense, lazy } from 'react'
import { useMediaQuery } from './hooks/useMediaQuery'

const ArxivGraph = lazy(() => import('./components/Graph'))
const MobilePapers = lazy(() => import('./components/MobileView'))

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
      {isSmall ? (
        <MobilePapers src='/graph.json' />
      ) : (
        <ArxivGraph src='/graph.json' />
      )}
    </Suspense>
  )
}
