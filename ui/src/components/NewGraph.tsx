import { Plus } from 'lucide-react'

// Starting a graph lives in the graph picker's menu. Until the first graph
// exists there's no picker, so this outlined button stands in for it.
export function NewGraphButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-neutral-950 border border-neutral-700 text-[13px] text-neutral-300 hover:text-white hover:border-neutral-500 whitespace-nowrap transition-colors'
    >
      <Plus size={14} />
      New graph
    </button>
  )
}

export function NewGraphMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex w-full items-center gap-2 border-t border-[#333333] px-3 py-2 text-left text-sm text-[#4ea8de] hover:bg-[#333333] cursor-pointer'
    >
      <Plus size={14} className='shrink-0' />
      New graph
    </button>
  )
}
