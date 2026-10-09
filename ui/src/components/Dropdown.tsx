import { Children, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Dropdown({
  label,
  children,
  className = 'max-w-[240px]',
}: {
  label: ReactNode
  children?: ReactNode
  /** Button classes; defaults to the max width cap. */
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const canOpen = Children.toArray(children).length > 0

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div className='relative' ref={ref}>
      <button
        onClick={() => canOpen && setIsOpen((o) => !o)}
        title={typeof label === 'string' ? label : undefined}
        className={`flex items-center gap-1.5 ${className} px-2.5 py-1 rounded-md bg-neutral-950 border border-neutral-700 text-[13px] text-neutral-300 whitespace-nowrap transition-colors${canOpen ? ' hover:text-white hover:border-neutral-500 cursor-pointer' : ' cursor-default'}`}
      >
        <span className='truncate'>{label}</span>
        {canOpen && (
          <ChevronDown
            size={13}
            className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {canOpen && isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className='absolute top-full mt-1 left-0 z-40 bg-[#2a2a2a] border border-[#333333] rounded-xl overflow-hidden shadow-lg min-w-[160px] max-w-[320px]'
        >
          {children}
        </div>
      )}
    </div>
  )
}
