import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Router state a link sets to land on a view with the new-graph modal open
// (the About page's "Create a graph")
export const NEW_GRAPH_STATE = { newGraph: true } as const

// Whether this view was opened with NEW_GRAPH_STATE. Read once on mount; the
// state is then cleared from history so a reload or Back doesn't reopen it.
export function useNewGraphRequest(): boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const [requested] = useState(
    () => (location.state as { newGraph?: boolean } | null)?.newGraph === true,
  )

  useEffect(() => {
    if (requested)
      navigate(location.pathname + location.search, {
        replace: true,
        state: null,
      })
    // Only on mount: later navigations aren't requests
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return requested
}
