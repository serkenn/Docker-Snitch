import { useState, useEffect, useRef } from 'react'
import type { LeakTestResult } from '../types'
import { api } from '../api/client'

export function LeakStatus() {
  const [result, setResult] = useState<LeakTestResult | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [flash, setFlash] = useState(false)
  const prevStatus = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const load = () => {
      api.getLeakTest().then(r => {
        if (!active) return
        // Flash on status change
        if (prevStatus.current !== null && prevStatus.current !== r.status) {
          setFlash(true)
          setTimeout(() => setFlash(false), 3000)
        }
        prevStatus.current = r.status
        setResult(r)
      }).catch(() => {})
    }
    load()
    const id = setInterval(load, 10000)
    return () => { active = false; clearInterval(id) }
  }, [])

  if (!result) return null

  const config = STATUS_CONFIG[result.status] || STATUS_CONFIG.warning

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          ...styles.badge,
          background: config.bg,
          borderColor: config.border,
          animation: flash ? 'leak-flash 0.5s ease-in-out 3' : undefined,
        }}
        title={config.title}
      >
        <span style={styles.icon}>{config.icon}</span>
        <span style={{ color: config.color, fontWeight: 600, fontSize: 11 }}>{config.label}</span>
        {result.status === 'secure' && result.vpn_conn_count > 0 && (
          <span style={styles.countBadge}>{result.vpn_conn_count}</span>
        )}
        {result.status === 'leak' && result.direct_conn_count > 0 && (
          <span style={{ ...styles.countBadge, background: '#f85149' }}>{result.direct_conn_count}</span>
        )}
      </button>

      {expanded && (
        <div style={styles.dropdown}>
          <div style={styles.dropdownHeader}>
            <span style={{ color: config.color, fontWeight: 700 }}>{config.icon} {config.title}</span>
          </div>

          {result.server_ip && (
            <div style={styles.row}>
              <span style={styles.rowLabel}>Server IP</span>
              <span style={styles.rowValue}>{result.server_ip}</span>
            </div>
          )}

          {result.mullvad_exits && result.mullvad_exits.length > 0 && (
            <div style={styles.row}>
              <span style={styles.rowLabel}>Mullvad Exits</span>
              <span style={styles.rowValue}>{result.mullvad_exits.join(', ')}</span>
            </div>
          )}

          <div style={styles.row}>
            <span style={styles.rowLabel}>VPN Connections</span>
            <span style={{ ...styles.rowValue, color: '#3fb950' }}>{result.vpn_conn_count}</span>
          </div>

          <div style={styles.row}>
            <span style={styles.rowLabel}>Direct (Leaked)</span>
            <span style={{ ...styles.rowValue, color: result.direct_conn_count > 0 ? '#f85149' : '#3fb950' }}>
              {result.direct_conn_count}
            </span>
          </div>

          {result.leaked_connections && result.leaked_connections.length > 0 && (
            <div style={styles.leakSection}>
              <div style={styles.leakHeader}>Leaked Connections</div>
              {result.leaked_connections.map((lc, i) => (
                <div key={i} style={styles.leakRow}>
                  <span style={styles.leakIP}>{lc.domain || lc.remote_ip}:{lc.remote_port}</span>
                  <span style={styles.leakMeta}>
                    {[lc.country, lc.isp, lc.category].filter(Boolean).join(' / ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={styles.checkedAt}>
            Checked: {new Date(result.checked_at).toLocaleTimeString()}
          </div>
        </div>
      )}

      <style>{`
        @keyframes leak-flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}

const STATUS_CONFIG: Record<string, { icon: string; label: string; title: string; color: string; bg: string; border: string }> = {
  secure: {
    icon: '\u{1F512}',
    label: 'VPN OK',
    title: 'Torrent traffic is routed through Mullvad VPN',
    color: '#3fb950',
    bg: '#0d2818',
    border: '#238636',
  },
  leak: {
    icon: '\u{26A0}\uFE0F',
    label: 'LEAK!',
    title: 'Torrent traffic is bypassing VPN!',
    color: '#f85149',
    bg: '#3d1116',
    border: '#f85149',
  },
  warning: {
    icon: '\u{1F7E1}',
    label: 'No VPN',
    title: 'No VPN connections detected for torrent client',
    color: '#d29922',
    bg: '#2d1d00',
    border: '#d29922',
  },
  no_torrent: {
    icon: '\u{1F4E6}',
    label: 'No Torrent',
    title: 'No torrent client containers detected',
    color: '#8b949e',
    bg: '#161b22',
    border: '#30363d',
  },
}

const styles: Record<string, React.CSSProperties> = {
  badge: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', border: '1px solid', borderRadius: 8,
    cursor: 'pointer', fontSize: 12, background: 'transparent',
    transition: 'all 0.2s',
  },
  icon: { fontSize: 13 },
  countBadge: {
    fontSize: 9, fontWeight: 700, color: '#fff',
    background: '#238636', borderRadius: 10, padding: '1px 5px',
    minWidth: 16, textAlign: 'center',
  },
  dropdown: {
    position: 'absolute', top: '100%', right: 0, marginTop: 8,
    background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
    padding: 14, minWidth: 300, zIndex: 1000,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  dropdownHeader: {
    fontSize: 13, marginBottom: 10, paddingBottom: 8,
    borderBottom: '1px solid #30363d',
  },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '3px 0', fontSize: 12,
  },
  rowLabel: { color: '#8b949e' },
  rowValue: { color: '#c9d1d9', fontFamily: 'monospace', fontSize: 11 },
  leakSection: {
    marginTop: 8, padding: 8, background: '#3d1116', borderRadius: 6,
    border: '1px solid #f85149',
  },
  leakHeader: {
    fontSize: 11, fontWeight: 700, color: '#f85149', marginBottom: 6,
  },
  leakRow: {
    display: 'flex', flexDirection: 'column', gap: 1, padding: '2px 0',
    borderBottom: '1px solid rgba(248,81,73,0.2)',
  },
  leakIP: { fontSize: 11, color: '#f85149', fontFamily: 'monospace' },
  leakMeta: { fontSize: 10, color: '#8b949e' },
  checkedAt: {
    fontSize: 10, color: '#484f58', marginTop: 8, textAlign: 'right',
  },
}
