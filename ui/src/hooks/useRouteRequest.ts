import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Router state a link sets to ask the view it lands on to do something once.
// Both come from the About page.
type RouteRequest = 'newGraph' | 'tour'

// Open the new-graph modal ("Create a graph")
export const NEW_GRAPH_STATE = { newGraph: true } as const
// Show the graph tour, even if it was seen before ("Take the tour")
export const TOUR_STATE = { tour: true } as const

// Whether this view was opened with the given request. Read once on mount;
// the state is then cleared from history so a reload or Back doesn't repeat it.
function useRouteRequest(key: RouteRequest): boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const [requested] = useState(
    () =>
      (location.state as Partial<Record<RouteRequest, boolean>> | null)?.[
        key
      ] === true,
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

export const useNewGraphRequest = () => useRouteRequest('newGraph')
export const useTourRequest = () => useRouteRequest('tour')
