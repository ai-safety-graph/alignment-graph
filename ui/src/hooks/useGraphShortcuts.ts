import { useEffect } from 'react'

function isTypingInField(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  const editable = (el as HTMLElement).isContentEditable
  return tag === 'input' || tag === 'textarea' || editable
}

export function useGraphShortcuts(opts: {
  query: string
  setQuery: (s: string) => void
  onBackgroundClick: () => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { query, setQuery, onBackgroundClick, searchInputRef } = opts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingInField(e)
      if (
        (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) ||
        (e.key === '/' && !e.metaKey && !e.ctrlKey && !typing)
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select?.()
        return
      }
      if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault()
        if (query) {
          setQuery('')
          onBackgroundClick()
        }
        return
      }
      if (
        e.key === 'Escape' &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault()
        if (query) {
          setQuery('')
          onBackgroundClick()
        } else {
          ;(document.activeElement as HTMLElement)?.blur?.()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, setQuery, onBackgroundClick, searchInputRef])
}
