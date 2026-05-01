import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { cidToColor } from '../lib/colors'
import type { ClustersLegend } from '../lib/types'

export default function ClusterPieChart({
  clusters,
}: {
  clusters: ClustersLegend
}) {
  const data = Object.entries(clusters).map(([cid, { label, size }]) => ({
    name: label ?? `Cluster ${cid}`,
    value: size,
    cid: Number(cid),
  }))
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className='w-full flex flex-col items-center gap-4'>
      <p className='text-neutral-400 text-sm'>
        {total.toLocaleString()} papers across {data.length} clusters
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
              <Cell key={entry.cid} fill={cidToColor(entry.cid)} />
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
