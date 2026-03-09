import { memo } from 'react'
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

const CATEGORY_COLORS: Record<string, string> = {
  tailnet: '#7c3aed',
  gcp: '#4285f4',
  mullvad: '#294a00',
  private: '#484f58',
  cloudflare: '#f38020',
  aws: '#ff9900',
  azure: '#0078d4',
  hetzner: '#d50c2d',
  ovh: '#000e9c',
  internet: '#8b949e',
  resolving: '#484f58',
}

const CATEGORY_LABELS: Record<string, string> = {
  tailnet: 'Tailnet',
  gcp: 'GCP',
  mullvad: 'Mullvad',
  private: 'Local',
  cloudflare: 'Cloudflare',
  aws: 'AWS',
  azure: 'Azure',
  hetzner: 'Hetzner',
  ovh: 'OVH',
  internet: 'Internet',
  resolving: '...',
}

function flagEmoji(code?: string): string {
  if (!code || code.length !== 2 || code === 'TS' || code === 'LO' || code === 'VPN' || code === 'GCP') return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
}

interface Props {
  connections: Connection[]
  onBlock: (conn: Connection) => void
}

export const ConnectionTable = memo(function ConnectionTable({ connections, onBlock }: Props) {
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
            <th style={styles.th}>Location</th>
            <th style={styles.th}>ISP / Org</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>Action</th>
            <th style={styles.th}>Sent</th>
            <th style={styles.th}>Recv</th>
            <th style={styles.th}>Time</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={13} style={{ ...styles.td, textAlign: 'center', color: '#484f58' }}>
                No active connections
              </td>
            </tr>
          )}
          {sorted.map(conn => (
            <tr key={conn.id}>
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
                <span>
                  {flagEmoji(conn.country_code)}{' '}
                  {conn.city && conn.country ? `${conn.city}, ${conn.country}` : conn.country || ''}
                </span>
              </td>
              <td style={styles.td}>
                <span style={styles.isp} title={conn.asn}>
                  {conn.isp || conn.org || ''}
                </span>
              </td>
              <td style={styles.td}>
                {conn.category && (
                  <span style={{
                    ...styles.categoryBadge,
                    background: CATEGORY_COLORS[conn.category] || '#484f58',
                  }}>
                    {CATEGORY_LABELS[conn.category] || conn.category}
                  </span>
                )}
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
})

const styles: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #30363d',
    color: '#8b949e', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap',
  },
  td: { padding: '4px 8px', borderBottom: '1px solid #21262d', whiteSpace: 'nowrap' },
  containerName: { color: '#58a6ff', fontWeight: 500 },
  outbound: { color: '#f0883e' },
  inbound: { color: '#3fb950' },
  remote: { color: '#c9d1d9' },
  ip: { color: '#484f58', fontSize: 10 },
  proto: { color: '#8b949e', fontSize: 11 },
  isp: { color: '#8b949e', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' },
  categoryBadge: {
    color: '#fff', padding: '1px 6px', borderRadius: 8, fontSize: 10,
    fontWeight: 600, display: 'inline-block',
  },
  allow: {
    color: '#3fb950', background: '#0d2818', padding: '1px 6px',
    borderRadius: 10, fontSize: 10,
  },
  block: {
    color: '#f85149', background: '#3d1116', padding: '1px 6px',
    borderRadius: 10, fontSize: 10,
  },
  blockBtn: {
    padding: '1px 6px', background: '#da3633', color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 10,
  },
}
