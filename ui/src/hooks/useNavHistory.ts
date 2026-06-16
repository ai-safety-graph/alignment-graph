import { useCallback, useState } from 'react'

export type NavEntry = { aid: string; title: string }

/**
 * Tracks the selected paper plus a breadcrumb trail built by following
 * related-paper links, so the detail panel can offer "back to" navigation.
 * StatsView-specific (MobileView has no breadcrumb).
 */
export function useNavHistory() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [navHistory, setNavHistory] = useState<NavEntry[]>([])

  /** Select a paper from the main list — starts a fresh trail. */
  const selectFromList = useCallback((aid: string) => {
    setNavHistory([])
    setSelectedId(aid)
  }, [])

  /** Follow a related-paper link, recording the current paper as a breadcrumb. */
  const selectRelated = useCallback((from: NavEntry | null, toAid: string) => {
    if (from) setNavHistory((prev) => [...prev, from])
    setSelectedId(toAid)
  }, [])

  /** Jump back to a breadcrumb, truncating the trail at that point. */
  const navigateTo = useCallback((aid: string, historyIndex: number) => {
    setNavHistory((h) => h.slice(0, historyIndex))
    setSelectedId(aid)
  }, [])

  const close = useCallback(() => {
    setSelectedId(null)
    setNavHistory([])
  }, [])

  return { selectedId, navHistory, selectFromList, selectRelated, navigateTo, close }
}
