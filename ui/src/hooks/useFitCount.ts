import { useLayoutEffect, useState } from 'react'

// How many of `count` items fit in a box capped by max-height with
// overflow hidden. The caller renders the first `shown` items, then a
// marker (e.g. "…") when some are left out; items are dropped from the end
// until the content, marker included, no longer overflows. Measures run in
// layout effects, so the drops land before paint.
//
// Re-measures when `resetKey` or `count` changes, or when the parent's
// width does. The parent, not the box itself: a content-sized box shrinks
// as items are dropped, which would restart the count.
export function useFitCount(
  count: number,
  resetKey: string,
): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  const key = `${resetKey}|${count}|${width}`
  const [fit, setFit] = useState({ key, shown: count })
  let shown = fit.shown
  if (fit.key !== key) {
    shown = count
    setFit({ key, shown })
  }

  useLayoutEffect(() => {
    const parent = el?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    )
    ro.observe(parent)
    return () => ro.disconnect()
  }, [el])

  useLayoutEffect(() => {
    if (el && shown > 0 && el.scrollHeight > el.clientHeight) {
      setFit({ key, shown: shown - 1 })
    }
  }, [el, shown, key])

  return [setEl, shown]
}
