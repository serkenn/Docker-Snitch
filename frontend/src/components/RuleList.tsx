import type { Rule } from '../types'

interface Props {
  rules: Rule[]
  onEdit: (rule: Rule) => void
  onDelete: (id: number) => void
  onToggle: (rule: Rule) => void
}

export function RuleList({ rules, onEdit, onDelete, onToggle }: Props) {
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>On</th>
          <th style={styles.th}>Pri</th>
          <th style={styles.th}>Container</th>
          <th style={styles.th}>Direction</th>
          <th style={styles.th}>Remote Host</th>
          <th style={styles.th}>Port</th>
          <th style={styles.th}>Protocol</th>
          <th style={styles.th}>Action</th>
          <th style={styles.th}>Note</th>
          <th style={styles.th}></th>
        </tr>
      </thead>
      <tbody>
        {rules.length === 0 && (
          <tr>
            <td colSpan={10} style={{ ...styles.td, textAlign: 'center', color: '#484f58' }}>
              No rules defined. All traffic is allowed by default.
            </td>
          </tr>
        )}
        {rules.map(r => (
          <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
            <td style={styles.td}>
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={() => onToggle(r)}
              />
            </td>
            <td style={styles.td}>{r.priority}</td>
            <td style={styles.td}>
              <span style={{ color: '#58a6ff' }}>{r.container_name}</span>
            </td>
            <td style={styles.td}>{r.direction}</td>
            <td style={styles.td}>{r.remote_host}</td>
            <td style={styles.td}>{r.remote_port === 0 ? '*' : r.remote_port}</td>
            <td style={styles.td}>{r.protocol}</td>
            <td style={styles.td}>
              <span style={r.action === 'allow' ? styles.allow : styles.block}>
                {r.action}
              </span>
            </td>
            <td style={styles.td}>{r.note}</td>
            <td style={styles.td}>
              <button style={styles.btn} onClick={() => onEdit(r)}>Edit</button>
              <button style={styles.delBtn} onClick={() => onDelete(r.id!)}>Del</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const styles: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #30363d',
    color: '#8b949e', fontWeight: 500, fontSize: 12,
  },
  td: { padding: '6px 12px', borderBottom: '1px solid #21262d' },
  allow: { color: '#3fb950', background: '#0d2818', padding: '2px 8px', borderRadius: 10, fontSize: 11 },
  block: { color: '#f85149', background: '#3d1116', padding: '2px 8px', borderRadius: 10, fontSize: 11 },
  btn: {
    padding: '2px 8px', background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d',
    borderRadius: 4, cursor: 'pointer', fontSize: 11, marginRight: 4,
  },
  delBtn: {
    padding: '2px 8px', background: 'transparent', color: '#f85149', border: '1px solid #f85149',
    borderRadius: 4, cursor: 'pointer', fontSize: 11,
  },
}
