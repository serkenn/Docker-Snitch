import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { Connection } from '../types'

interface Props {
  connections: Connection[]
}

export function TrafficChart({ connections }: Props) {
  const data = useMemo(() => {
    // Aggregate bytes per container
    const byContainer = new Map<string, { sent: number; recv: number }>()
    for (const c of connections) {
      const existing = byContainer.get(c.container) || { sent: 0, recv: 0 }
      existing.sent += c.bytes_sent
      existing.recv += c.bytes_recv
      byContainer.set(c.container, existing)
    }

    return Array.from(byContainer.entries())
      .map(([name, { sent, recv }]) => ({
        name,
        sent: Math.round(sent / 1024),
        recv: Math.round(recv / 1024),
      }))
      .sort((a, b) => (b.sent + b.recv) - (a.sent + a.recv))
      .slice(0, 10)
  }, [connections])

  if (data.length === 0) {
    return (
      <div style={styles.empty}>
        Waiting for traffic data...
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Traffic by Container (KB)</div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: '#8b949e', fontSize: 11 }}
            axisLine={{ stroke: '#30363d' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8b949e', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#c9d1d9' }}
          />
          <Area type="monotone" dataKey="sent" stackId="1" stroke="#f0883e" fill="#f0883e" fillOpacity={0.3} name="Sent (KB)" />
          <Area type="monotone" dataKey="recv" stackId="1" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.3} name="Recv (KB)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 16, marginBottom: 16,
  },
  header: { fontSize: 12, color: '#8b949e', marginBottom: 8 },
  empty: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 32, marginBottom: 16, textAlign: 'center', color: '#484f58', fontSize: 13,
  },
}
