import type { Connection } from '../types'

interface Props {
  connection: Connection
  onClose: () => void
  onBlock: (conn: Connection) => void
}

export function ConnectionDetail({ connection: c, onClose, onBlock }: Props) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.title}>Connection Detail</h3>

        <div style={styles.grid}>
          <Row label="Container" value={c.container} />
          <Row label="Container IP" value={c.container_ip} />
          <Row label="Direction" value={c.direction} />
          <Row label="Remote" value={c.remote_domain ? `${c.remote_domain} (${c.remote_ip})` : c.remote_ip} />
          <Row label="Remote Port" value={String(c.remote_port)} />
          <Row label="Local Port" value={String(c.local_port)} />
          <Row label="Protocol" value={c.protocol.toUpperCase()} />
          <Row label="Action" value={c.action} />
          <Row label="Bytes Sent" value={String(c.bytes_sent)} />
          <Row label="Bytes Received" value={String(c.bytes_recv)} />
          <Row label="Started" value={new Date(c.start_time).toLocaleString()} />
          <Row label="Last Seen" value={new Date(c.last_seen).toLocaleString()} />
        </div>

        <div style={styles.buttons}>
          <button style={styles.closeBtn} onClick={onClose}>Close</button>
          {c.action === 'allow' && (
            <button style={styles.blockBtn} onClick={() => onBlock(c)}>
              Create Block Rule
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={styles.label}>{label}</div>
      <div style={styles.value}>{value}</div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
    padding: 24, width: 450,
  },
  title: { fontSize: 16, marginBottom: 16, color: '#c9d1d9' },
  grid: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px' },
  label: { fontSize: 12, color: '#8b949e' },
  value: { fontSize: 13, color: '#c9d1d9', wordBreak: 'break-all' },
  buttons: { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  closeBtn: {
    padding: '8px 16px', background: '#21262d', border: '1px solid #30363d',
    borderRadius: 6, color: '#c9d1d9', cursor: 'pointer', fontSize: 13,
  },
  blockBtn: {
    padding: '8px 16px', background: '#da3633', border: 'none',
    borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13,
  },
}
