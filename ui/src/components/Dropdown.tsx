import { Children, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Dropdown({
  label,
  children,
}: {
  label: ReactNode
  children?: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const canOpen = Children.count(children) > 0

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
        className={`flex items-center gap-1.5 px-3 py-[7px] rounded-full bg-[#2a2a2a] border border-[#333333] text-sm text-neutral-400 whitespace-nowrap${canOpen ? ' hover:text-neutral-200 cursor-pointer' : ' cursor-default'}`}
      >
        {label}
        {canOpen && (
          <ChevronDown
            size={13}
            className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {canOpen && isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className='absolute top-full mt-1 left-0 bg-[#2a2a2a] border border-[#333333] rounded-xl overflow-hidden shadow-lg min-w-[160px]'
        >
          {children}
        </div>
      )}
    </div>
  )
}
