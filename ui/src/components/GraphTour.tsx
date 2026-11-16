import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'

import { track } from '../lib/analytics'
import { TOUR_STEPS } from './tourSteps'

export type TourCloseReason = 'done' | 'skip'

const PAD = 6
const GUTTER = 16
const CARD_WIDTH = 300
// Rough card height, to decide whether it fits below the target
const CARD_ROOM = 200

type Rect = { top: number; left: number; width: number; height: number }

function measure(target: string | null): Rect | null {
  if (!target) return null
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // Unrendered or hidden targets fall back to a centred card
  if (!r.width && !r.height) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

// A short, skippable walk through the graph view. Each step highlights an
// element marked with `data-tour` and explains it in a card beside it.
// Mounted only while open, so it always starts at the first step.
export default function GraphTour({
  onClose,
}: {
  onClose: (reason: TourCloseReason) => void
}) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1

  useLayoutEffect(() => {
    const update = () => setRect(measure(step.target))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [step.target])

  // Hand focus back to whatever had it (e.g. the Tour button) on close.
  // Declared before the effect below so it records focus before Next takes it.
  useEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener !== document.body)
        opener.focus()
    }
  }, [])

  useEffect(() => {
    nextRef.current?.focus()
  }, [index])

  const close = useCallback(
    (reason: TourCloseReason) => {
      track('tour_close', { reason, step: index + 1 })
      onClose(reason)
    },
    [index, onClose],
  )
  const next = useCallback(
    () => (last ? close('done') : setIndex((i) => i + 1)),
    [last, close],
  )
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('skip')
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else if (e.key === 'Tab') {
        // Keep Tab inside the card: the page behind it is covered, and a
        // control reached there (e.g. New graph) would open under the tour
        const buttons = [
          ...(dialogRef.current?.querySelectorAll('button') ?? []),
        ]
        if (!buttons.length) return
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const dir = e.shiftKey ? -1 : 1
        const to =
          at === -1
            ? e.shiftKey
              ? buttons.length - 1
              : 0
            : (at + dir + buttons.length) % buttons.length
        buttons[to].focus()
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, next, back])

  // Below the target when there's room, otherwise above; clamped to the
  // viewport either way
  let cardStyle: CSSProperties
  if (rect) {
    const left = Math.min(
      Math.max(rect.left - PAD, GUTTER),
      window.innerWidth - CARD_WIDTH - GUTTER,
    )
    const below = rect.top + rect.height + PAD + 12
    cardStyle =
      below + CARD_ROOM < window.innerHeight
        ? { left, top: below }
        : { left, bottom: window.innerHeight - rect.top + PAD + 12 }
  } else {
    cardStyle = {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  return (
    <div className='fixed inset-0 z-50'>
      {/* Catches clicks so the graph behind can't be used mid-tour */}
      <div
        className={`absolute inset-0 ${rect ? '' : 'bg-black/70'}`}
        aria-hidden
      />
      {rect && (
        <div
          data-testid='tour-highlight'
          aria-hidden
          className='absolute rounded pointer-events-none transition-all duration-200'
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            // Tailwind's ring is a box-shadow too, so both go in one
            boxShadow: '0 0 0 2px #4ea8de, 0 0 0 9999px rgba(0,0,0,0.7)',
          }}
        />
      )}
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='graph-tour-title'
        className='absolute bg-neutral-950 rounded px-4 py-3 text-[13px] text-neutral-400 shadow-xl'
        style={{ width: CARD_WIDTH, ...cardStyle }}
      >
        <h2
          id='graph-tour-title'
          className='text-[14px] font-medium text-neutral-200 mb-1.5'
        >
          {step.title}
        </h2>
        <p className='leading-snug'>{step.body}</p>
        <div className='flex items-center gap-2 mt-3'>
          <button
            type='button'
            onClick={() => close('skip')}
            className='mr-auto text-[12px] text-neutral-500 hover:text-neutral-300 cursor-pointer'
          >
            Skip tour
          </button>
          <span className='text-[12px] text-neutral-500'>
            {index + 1} / {TOUR_STEPS.length}
          </span>
          {index > 0 && (
            <button
              type='button'
              onClick={back}
              className='px-2 py-0.5 rounded-md border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white cursor-pointer'
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type='button'
            onClick={next}
            className='px-2.5 py-0.5 rounded-md bg-[#4ea8de] hover:bg-[#6bb8e6] text-neutral-950 font-medium cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white'
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
