import Dropdown from './Dropdown'

export interface SubgraphSummary {
  id: string
  name: string
}

export default function SubgraphDropdown({
  subgraphs,
  selectedId,
  onSelect,
  onCreate,
}: {
  subgraphs: SubgraphSummary[]
  selectedId?: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  const selected = subgraphs.find((s) => s.id === selectedId)
  const label = selected?.name ?? 'No subgraph selected'

  return (
    <Dropdown label={label}>
      {subgraphs.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className='block w-full text-left px-3 py-2 text-sm text-neutral-300 hover:bg-[#333333] hover:text-neutral-100'
        >
          {s.name}
        </button>
      ))}
      <button
        onClick={onCreate}
        className={`block w-full text-left px-3 py-2 text-sm text-neutral-300 hover:bg-[#333333] hover:text-neutral-100${subgraphs.length ? ' border-t border-[#333333]' : ''}`}
      >
        Create a subgraph
      </button>
    </Dropdown>
  )
}
