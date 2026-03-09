import { useState } from 'react'
import type { Rule } from '../types'

interface Props {
  rule: Rule
  onSave: (rule: Rule) => void
  onCancel: () => void
}

export function RuleEditor({ rule: initial, onSave, onCancel }: Props) {
  const [rule, setRule] = useState<Rule>({ ...initial })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(rule)
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, children: React.ReactNode) => (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  )

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.title}>{rule.id ? 'Edit Rule' : 'New Rule'}</h3>

        {field('Container',
          <input
            style={styles.input}
            value={rule.container_name}
            onChange={e => setRule({ ...rule, container_name: e.target.value })}
            placeholder="* (all containers)"
          />
        )}

        {field('Direction',
          <select style={styles.input} value={rule.direction}
            onChange={e => setRule({ ...rule, direction: e.target.value })}>
            <option value="both">Both</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        )}

        {field('Remote Host',
          <input
            style={styles.input}
            value={rule.remote_host}
            onChange={e => setRule({ ...rule, remote_host: e.target.value })}
            placeholder="* (any IP/CIDR)"
          />
        )}

        {field('Remote Port',
          <input
            style={styles.input}
            type="number"
            value={rule.remote_port}
            onChange={e => setRule({ ...rule, remote_port: parseInt(e.target.value) || 0 })}
            placeholder="0 (any)"
          />
        )}

        {field('Protocol',
          <select style={styles.input} value={rule.protocol}
            onChange={e => setRule({ ...rule, protocol: e.target.value })}>
            <option value="*">Any</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        )}

        {field('Action',
          <div style={styles.actions}>
            <button
              style={rule.action === 'allow' ? styles.allowBtn : styles.actionBtn}
              onClick={() => setRule({ ...rule, action: 'allow' })}
            >Allow</button>
            <button
              style={rule.action === 'block' ? styles.blockBtn : styles.actionBtn}
              onClick={() => setRule({ ...rule, action: 'block' })}
            >Block</button>
          </div>
        )}

        {field('Priority',
          <input
            style={styles.input}
            type="number"
            value={rule.priority}
            onChange={e => setRule({ ...rule, priority: parseInt(e.target.value) || 100 })}
          />
        )}

        {field('Note',
          <input
            style={styles.input}
            value={rule.note}
            onChange={e => setRule({ ...rule, note: e.target.value })}
            placeholder="Optional description"
          />
        )}

        <div style={styles.buttons}>
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
    padding: 24, width: 420, maxHeight: '90vh', overflowY: 'auto',
  },
  title: { fontSize: 16, marginBottom: 16, color: '#c9d1d9' },
  field: { marginBottom: 12 },
  label: { display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 4 },
  input: {
    width: '100%', padding: '8px 12px', background: '#0d1117', border: '1px solid #30363d',
    borderRadius: 6, color: '#c9d1d9', fontSize: 13, outline: 'none',
  },
  actions: { display: 'flex', gap: 8 },
  actionBtn: {
    flex: 1, padding: '8px', background: '#21262d', border: '1px solid #30363d',
    borderRadius: 6, color: '#8b949e', cursor: 'pointer', fontSize: 13,
  },
  allowBtn: {
    flex: 1, padding: '8px', background: '#0d2818', border: '1px solid #3fb950',
    borderRadius: 6, color: '#3fb950', cursor: 'pointer', fontSize: 13,
  },
  blockBtn: {
    flex: 1, padding: '8px', background: '#3d1116', border: '1px solid #f85149',
    borderRadius: 6, color: '#f85149', cursor: 'pointer', fontSize: 13,
  },
  buttons: { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '8px 16px', background: 'transparent', border: '1px solid #30363d',
    borderRadius: 6, color: '#8b949e', cursor: 'pointer', fontSize: 13,
  },
  saveBtn: {
    padding: '8px 16px', background: '#238636', border: 'none',
    borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13,
  },
}
