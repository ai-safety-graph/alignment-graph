import { useEffect, useRef, useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { track } from '../lib/analytics'
import { buildShareUrl, type SharedGraph } from '../lib/shareLink'

const COPIED_MS = 2000

// Phones and tablets get the system share sheet; elsewhere the link goes to
// the clipboard
const prefersShareSheet = () =>
  typeof navigator.share === 'function' &&
  window.matchMedia?.('(pointer: coarse)').matches === true

// Copies (or, on touch devices, shares) a link that opens `graph` as an
// unsaved draft for whoever follows it. When the clipboard is out of reach
// (an insecure context, a denied permission) the link is shown, selected,
// for copying by hand.
export default function ShareLinkButton({
  graph,
  view,
  className,
  iconSize = 11,
  label = 'Share',
}: {
  graph: SharedGraph
  // Where it was shared from, for analytics
  view: 'graph' | 'browse' | 'mobile'
  className: string
  iconSize?: number
  label?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (state !== 'copied') return
    const t = setTimeout(() => setState('idle'), COPIED_MS)
    return () => clearTimeout(t)
  }, [state])

  useEffect(() => {
    if (state === 'manual') inputRef.current?.select()
  }, [state])

  const share = async () => {
    const link = buildShareUrl(graph)
    setUrl(link)
    track('graph_share', {
      view,
      pins: graph.pinned.length,
      has_recipe: !!graph.filters,
    })
    if (prefersShareSheet()) {
      try {
        await navigator.share({ title: graph.name, url: link })
        return
      } catch (e) {
        // Dismissing the sheet isn't a failure
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      setState('copied')
    } catch {
      setState('manual')
    }
  }

  if (state === 'manual')
    return (
      <input
        ref={inputRef}
        readOnly
        value={url}
        aria-label='Link to this graph'
        onFocus={(e) => e.target.select()}
        onBlur={() => setState('idle')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Keep the graph's own Esc handler from deselecting too
            e.stopPropagation()
            setState('idle')
          }
        }}
        className='w-56 px-2 py-0.5 rounded-md bg-neutral-900 border border-[#333333] text-xs text-[#e5e5e5] outline-none focus:ring-2 focus:ring-[#4ea8de]'
      />
    )

  return (
    <button
      type='button'
      onClick={share}
      title='Copy a link that opens this graph for anyone'
      className={className}
    >
      {state === 'copied' ? (
        <Check size={iconSize} />
      ) : (
        <Link2 size={iconSize} />
      )}
      {/* Announced, so a screen reader hears the copy happen */}
      <span aria-live='polite'>
        {state === 'copied' ? 'Link copied' : label}
      </span>
    </button>
  )
}
