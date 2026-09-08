import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { tagToColor } from '../lib/colors'
import type { TagsLegend } from '../lib/types'

export default function ClusterPieChart({
  tags,
}: {
  tags: TagsLegend
}) {
  // Each paper is counted once, under its primary (top-scored) tag only --
  // otherwise a multi-tag paper would inflate the pie past 100%.
  const data = Object.entries(tags)
    .map(([tag, { primary_size }]) => ({
      name: tag,
      value: primary_size ?? 0,
    }))
    .filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className='w-full flex flex-col items-center gap-4'>
      <p className='text-neutral-400 text-sm'>
        {total.toLocaleString()} papers across {data.length} tags
      </p>
      <ResponsiveContainer width='100%' height={420}>
        <PieChart>
          <Pie
            data={data}
            dataKey='value'
            nameKey='name'
            cx='50%'
            cy='50%'
            outerRadius={160}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={tagToColor(entry.name)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              `${Number(value).toLocaleString()} papers (${((Number(value) / total) * 100).toFixed(1)}%)`,
              String(name),
            ]}
            contentStyle={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              color: '#e5e5e5',
            }}
            itemStyle={{ color: '#e5e5e5' }}
            labelStyle={{ color: '#e5e5e5' }}
          />
          <Legend
            formatter={(value) => (
              <span style={{ color: '#e5e5e5', fontSize: 13 }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
