import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient.ts'

// A stale tab can hold references to chunk hashes from before a deploy.
// When a lazy import 404s against the new deploy, reload once to fetch
// the current index.html instead of leaving the app on a blank screen.
window.addEventListener('vite:preloadError', () => {
  const reloadedAt = Number(sessionStorage.getItem('chunk-reload-at') ?? 0)
  if (Date.now() - reloadedAt > 10_000) {
    sessionStorage.setItem('chunk-reload-at', String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
