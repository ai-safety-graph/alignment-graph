import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  parseShareParams,
  withoutShareParams,
  type SharedGraph,
} from '../lib/shareLink'

// The graph a share link opened this view with, read once on mount. The
// params stay in the URL while the shared graph is shown, so a reload keeps
// it; the view calls clearShareParams once it moves on (saved, discarded,
// edited or another graph opened).
export function useSharedGraph(): {
  shared: SharedGraph | null
  clearShareParams: () => void
} {
  const location = useLocation()
  const navigate = useNavigate()
  const [shared] = useState(() =>
    parseShareParams(new URLSearchParams(location.search)),
  )

  const { pathname, search, hash } = location
  const clearShareParams = useCallback(() => {
    const rest = withoutShareParams(search)
    if (rest !== search)
      navigate(pathname + rest + hash, { replace: true, state: null })
  }, [navigate, pathname, search, hash])

  return { shared, clearShareParams }
}
