import type { Connection } from '../types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

function formatDuration(start: string): string {
  const ms = Date.now() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

interface Props {
  connections: Connection[]
  onBlock: (conn: Connection) => void
}

export function ConnectionTable({ connections, onBlock }: Props) {
  const sorted = [...connections].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Container</th>
            <th style={styles.th}>Dir</th>
            <th style={styles.th}>Remote</th>
            <th style={styles.th}>Port</th>
            <th style={styles.th}>Proto</th>
            <th style={styles.th}>Action</th>
            <th style={styles.th}>Sent</th>
            <th style={styles.th}>Recv</th>
            <th style={styles.th}>Duration</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={10} style={{ ...styles.td, textAlign: 'center', color: '#484f58' }}>
                No active connections
              </td>
            </tr>
          )}
          {sorted.map(conn => (
            <tr key={conn.id} style={styles.row}>
              <td style={styles.td}>
                <span style={styles.containerName}>{conn.container}</span>
              </td>
              <td style={styles.td}>
                <span style={conn.direction === 'outbound' ? styles.outbound : styles.inbound}>
                  {conn.direction === 'outbound' ? '\u2191' : '\u2193'}
                </span>
              </td>
              <td style={styles.td}>
                <span style={styles.remote}>
                  {conn.remote_domain || conn.remote_ip}
                </span>
                {conn.remote_domain && (
                  <span style={styles.ip}> ({conn.remote_ip})</span>
                )}
              </td>
              <td style={styles.td}>{conn.remote_port}</td>
              <td style={styles.td}>
                <span style={styles.proto}>{conn.protocol.toUpperCase()}</span>
              </td>
              <td style={styles.td}>
                <span style={conn.action === 'allow' ? styles.allow : styles.block}>
                  {conn.action}
                </span>
              </td>
              <td style={styles.td}>{formatBytes(conn.bytes_sent)}</td>
              <td style={styles.td}>{formatBytes(conn.bytes_recv)}</td>
              <td style={styles.td}>{formatDuration(conn.start_time)}</td>
              <td style={styles.td}>
                {conn.action === 'allow' && (
                  <button style={styles.blockBtn} onClick={() => onBlock(conn)}>
                    Block
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #30363d',
    color: '#8b949e', fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap',
  },
  td: { padding: '6px 12px', borderBottom: '1px solid #21262d', whiteSpace: 'nowrap' },
  row: { transition: 'background 0.2s' },
  containerName: { color: '#58a6ff', fontWeight: 500 },
  outbound: { color: '#f0883e' },
  inbound: { color: '#3fb950' },
  remote: { color: '#c9d1d9' },
  ip: { color: '#484f58', fontSize: 11 },
  proto: { color: '#8b949e', fontSize: 11, textTransform: 'uppercase' as const },
  allow: {
    color: '#3fb950', background: '#0d2818', padding: '2px 8px',
    borderRadius: 10, fontSize: 11,
  },
  block: {
    color: '#f85149', background: '#3d1116', padding: '2px 8px',
    borderRadius: 10, fontSize: 11,
  },
  blockBtn: {
    padding: '2px 8px', background: '#da3633', color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 11,
  },
}
