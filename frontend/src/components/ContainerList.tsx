import type { Container, Connection } from '../types'

type SelectionMode = 'all' | 'single' | 'multi'

interface Props {
  containers: Container[]
  selectedContainers: Set<string>
  onSelectionChange: (selected: Set<string>) => void
  connections: Connection[]
}

export function ContainerList({ containers, selectedContainers, onSelectionChange, connections }: Props) {
  const counts = new Map<string, number>()
  const bytesByContainer = new Map<string, { sent: number; recv: number }>()
  for (const c of connections) {
    counts.set(c.container, (counts.get(c.container) || 0) + 1)
    const existing = bytesByContainer.get(c.container) || { sent: 0, recv: 0 }
    existing.sent += c.bytes_sent
    existing.recv += c.bytes_recv
    bytesByContainer.set(c.container, existing)
  }

  // Determine current mode
  const mode: SelectionMode =
    selectedContainers.size === 0 ? 'all' :
    selectedContainers.size === 1 ? 'single' : 'multi'

  const isAllSelected = selectedContainers.size === 0

  const toggleContainer = (name: string, e: React.MouseEvent) => {
    const newSet = new Set(selectedContainers)
    if (e.ctrlKey || e.metaKey) {
      // Multi-select toggle
      if (newSet.has(name)) {
        newSet.delete(name)
      } else {
        newSet.add(name)
      }
    } else {
      // Single select (or deselect if already sole selection)
      if (newSet.size === 1 && newSet.has(name)) {
        newSet.clear()
      } else {
        newSet.clear()
        newSet.add(name)
      }
    }
    onSelectionChange(newSet)
  }

  const toggleCheckbox = (name: string) => {
    const newSet = new Set(selectedContainers)
    if (newSet.has(name)) {
      newSet.delete(name)
    } else {
      newSet.add(name)
    }
    onSelectionChange(newSet)
  }

  const selectAll = () => onSelectionChange(new Set())
  const selectNone = () => onSelectionChange(new Set())

  // Compute totals for selected
  const selectedNames = isAllSelected
    ? containers.map(c => c.name)
    : Array.from(selectedContainers)
  const totalConns = selectedNames.reduce((sum, n) => sum + (counts.get(n) || 0), 0)
  const totalSent = selectedNames.reduce((sum, n) => sum + (bytesByContainer.get(n)?.sent || 0), 0)
  const totalRecv = selectedNames.reduce((sum, n) => sum + (bytesByContainer.get(n)?.recv || 0), 0)

  return (
    <div>
      <div style={styles.header}>Containers</div>

      {/* All button */}
      <div
        style={isAllSelected ? styles.itemActive : styles.item}
        onClick={selectAll}
      >
        <span style={styles.dot('#58a6ff')} />
        <div style={styles.nameWrap}>
          <div style={styles.name}>All Containers</div>
        </div>
        <span style={styles.count}>{connections.length}</span>
      </div>

      {/* Hint */}
      <div style={styles.hint}>
        Cmd/Ctrl+Click for multi-select
      </div>

      {/* Container list */}
      {containers.map(c => {
        const isSelected = selectedContainers.has(c.name)
        const hasTraffic = counts.has(c.name)
        return (
          <div
            key={c.name}
            style={isSelected ? styles.itemActive : styles.item}
            onClick={(e) => toggleContainer(c.name, e)}
          >
            <input
              type="checkbox"
              checked={isAllSelected || isSelected}
              onChange={() => toggleCheckbox(c.name)}
              onClick={(e) => e.stopPropagation()}
              style={styles.checkbox}
            />
            <span style={styles.dot(hasTraffic ? '#3fb950' : '#484f58')} />
            <div style={styles.nameWrap}>
              <div style={styles.name}>{c.name}</div>
              <div style={styles.image}>{c.image || c.ip}</div>
            </div>
            {hasTraffic && (
              <span style={styles.count}>{counts.get(c.name)}</span>
            )}
          </div>
        )
      })}

      {containers.length === 0 && (
        <div style={styles.empty}>No containers detected</div>
      )}

      {/* Selection summary */}
      {!isAllSelected && selectedContainers.size > 0 && (
        <div style={styles.summary}>
          <div style={styles.summaryTitle}>
            {mode === 'single' ? 'Selected' : `${selectedContainers.size} Selected`}
          </div>
          <div style={styles.summaryRow}>
            <span>Connections</span>
            <span>{totalConns}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Sent</span>
            <span>{formatBytes(totalSent)}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Recv</span>
            <span>{formatBytes(totalRecv)}</span>
          </div>
          <button style={styles.clearBtn} onClick={selectNone}>
            Clear Selection
          </button>
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

const styles = {
  header: {
    padding: '8px 16px', fontSize: 11, fontWeight: 600,
    color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: 1,
  } as React.CSSProperties,
  hint: {
    padding: '2px 16px 6px', fontSize: 10, color: '#484f58', fontStyle: 'italic' as const,
  } as React.CSSProperties,
  item: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', cursor: 'pointer', fontSize: 13,
    borderLeft: '2px solid transparent',
  } as React.CSSProperties,
  itemActive: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', cursor: 'pointer', fontSize: 13,
    background: '#161b22', borderLeft: '2px solid #58a6ff',
  } as React.CSSProperties,
  checkbox: {
    accentColor: '#58a6ff', cursor: 'pointer', flexShrink: 0,
  } as React.CSSProperties,
  dot: (color: string) => ({
    width: 8, height: 8, borderRadius: '50%', background: color,
    flexShrink: 0,
  }) as React.CSSProperties,
  nameWrap: { flex: 1, minWidth: 0 } as React.CSSProperties,
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  image: { fontSize: 11, color: '#484f58', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  count: {
    fontSize: 11, color: '#8b949e', background: '#21262d',
    padding: '1px 6px', borderRadius: 10,
  } as React.CSSProperties,
  empty: { padding: '16px', color: '#484f58', fontSize: 12, textAlign: 'center' as const } as React.CSSProperties,
  summary: {
    margin: '12px 12px 0', padding: 12, background: '#161b22',
    border: '1px solid #30363d', borderRadius: 8,
  } as React.CSSProperties,
  summaryTitle: {
    fontSize: 11, fontWeight: 600, color: '#58a6ff', marginBottom: 8,
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  summaryRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: 12,
    color: '#8b949e', padding: '2px 0',
  } as React.CSSProperties,
  clearBtn: {
    marginTop: 8, width: '100%', padding: '4px 8px', background: '#21262d',
    border: '1px solid #30363d', borderRadius: 4, color: '#8b949e',
    cursor: 'pointer', fontSize: 11,
  } as React.CSSProperties,
}
