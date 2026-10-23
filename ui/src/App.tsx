import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useMediaQuery } from './hooks/useMediaQuery'
import LoadingIndicator from './components/LoadingIndicator'

const ArxivGraph = lazy(() => import('./components/GraphView'))
const BrowsePage = lazy(() => import('./components/BrowseView'))
const AboutPage = lazy(() => import('./components/AboutView'))

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
        <Route path='/' element={isSmall ? <BrowsePage /> : <ArxivGraph />} />
        <Route path='/browse' element={<BrowsePage />} />
        {/* Old name for /browse, kept so existing links still resolve. */}
        <Route path='/stats' element={<Navigate to='/browse' replace />} />
        <Route path='/about' element={<AboutPage />} />
      </Routes>
    </Suspense>
  )
}
