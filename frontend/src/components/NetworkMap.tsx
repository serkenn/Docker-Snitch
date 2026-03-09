import { useMemo, useEffect, useRef } from 'react'
import type { Connection, Container } from '../types'

interface Props {
  connections: Connection[]
  containers: Container[]
}

// Color palette for containers
const COLORS = [
  '#58a6ff', '#3fb950', '#f0883e', '#bc8cff', '#f778ba',
  '#79c0ff', '#56d364', '#d29922', '#d2a8ff', '#ff9bce',
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`
  return `${(bytes / 1073741824).toFixed(1)}GB`
}

// Sanitize string for Mermaid (remove special chars)
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

// Truncate long strings
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

export function NetworkMap({ connections, containers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const mermaidCode = useMemo(() => {
    if (connections.length === 0 && containers.length === 0) return ''

    // Aggregate connections: container -> remote endpoint
    const edges = new Map<string, {
      container: string
      remote: string
      remoteLabel: string
      protocol: string
      port: number
      bytesSent: number
      bytesRecv: number
      action: string
      count: number
    }>()

    for (const conn of connections) {
      const remoteLabel = conn.remote_domain || conn.remote_ip
      const key = `${conn.container}||${remoteLabel}:${conn.remote_port}/${conn.protocol}`
      const existing = edges.get(key)
      if (existing) {
        existing.bytesSent += conn.bytes_sent
        existing.bytesRecv += conn.bytes_recv
        existing.count++
        if (conn.action === 'block') existing.action = 'block'
      } else {
        edges.set(key, {
          container: conn.container,
          remote: remoteLabel,
          remoteLabel: truncate(remoteLabel, 25),
          protocol: conn.protocol,
          port: conn.remote_port,
          bytesSent: conn.bytes_sent,
          bytesRecv: conn.bytes_recv,
          action: conn.action,
          count: 1,
        })
      }
    }

    // Build Mermaid flowchart
    const lines: string[] = ['graph LR']

    // Style definitions
    lines.push('  classDef container fill:#161b22,stroke:#58a6ff,color:#c9d1d9,stroke-width:2px')
    lines.push('  classDef remote fill:#0d1117,stroke:#30363d,color:#8b949e,stroke-width:1px')
    lines.push('  classDef blocked fill:#3d1116,stroke:#f85149,color:#f85149,stroke-width:2px')
    lines.push('  classDef internet fill:#0d1117,stroke:#f0883e,color:#f0883e,stroke-width:2px')

    // Docker network node
    lines.push('  DOCKER_NET{{Docker Network}}')
    lines.push('  class DOCKER_NET internet')

    // Container nodes
    const containerIds = new Set<string>()
    const containerColorMap = new Map<string, string>()
    let colorIdx = 0

    for (const c of containers) {
      const id = `C_${sanitize(c.name)}`
      containerIds.add(id)
      containerColorMap.set(c.name, COLORS[colorIdx % COLORS.length])
      lines.push(`  ${id}["${truncate(c.name, 20)}<br/>${c.ip}"]`)
      lines.push(`  class ${id} container`)
      lines.push(`  DOCKER_NET --- ${id}`)
      colorIdx++
    }

    // Also add containers that appear in connections but not in container list
    for (const edge of edges.values()) {
      const id = `C_${sanitize(edge.container)}`
      if (!containerIds.has(id)) {
        containerIds.add(id)
        containerColorMap.set(edge.container, COLORS[colorIdx % COLORS.length])
        lines.push(`  ${id}["${truncate(edge.container, 20)}"]`)
        lines.push(`  class ${id} container`)
        lines.push(`  DOCKER_NET --- ${id}`)
        colorIdx++
      }
    }

    // Remote endpoint nodes and edges
    const remoteIds = new Set<string>()

    for (const edge of edges.values()) {
      const containerId = `C_${sanitize(edge.container)}`
      const remoteId = `R_${sanitize(edge.remote)}_${edge.port}`

      if (!remoteIds.has(remoteId)) {
        remoteIds.add(remoteId)
        const label = `${edge.remoteLabel}<br/>:${edge.port}`
        lines.push(`  ${remoteId}["${label}"]`)
        if (edge.action === 'block') {
          lines.push(`  class ${remoteId} blocked`)
        } else {
          lines.push(`  class ${remoteId} remote`)
        }
      }

      // Edge with traffic info
      const traffic = `${edge.protocol.toUpperCase()} ${formatBytes(edge.bytesSent + edge.bytesRecv)}`
      const connLabel = edge.count > 1 ? `${traffic} x${edge.count}` : traffic

      if (edge.action === 'block') {
        lines.push(`  ${containerId} -.-x|"${connLabel}"| ${remoteId}`)
      } else {
        lines.push(`  ${containerId} -->|"${connLabel}"| ${remoteId}`)
      }
    }

    return lines.join('\n')
  }, [connections, containers])

  // Render Mermaid
  useEffect(() => {
    if (!containerRef.current || !mermaidCode) return

    const renderMermaid = async () => {
      // Dynamically import mermaid
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#0d1117',
          primaryColor: '#161b22',
          primaryTextColor: '#c9d1d9',
          primaryBorderColor: '#30363d',
          lineColor: '#58a6ff',
          secondaryColor: '#21262d',
          tertiaryColor: '#161b22',
        },
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
          padding: 12,
        },
        securityLevel: 'loose',
      })

      try {
        const { svg } = await mermaid.render('network-map-svg', mermaidCode)
        if (containerRef.current) {
          containerRef.current.innerHTML = svg
          // Make SVG responsive
          const svgEl = containerRef.current.querySelector('svg')
          if (svgEl) {
            svgEl.style.maxWidth = '100%'
            svgEl.style.height = 'auto'
            svgEl.style.minHeight = '300px'
          }
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
        if (containerRef.current) {
          containerRef.current.innerHTML = `<pre style="color: #f85149; font-size: 12px;">${String(err)}</pre>`
        }
      }
    }

    renderMermaid()
  }, [mermaidCode])

  if (!mermaidCode) {
    return (
      <div style={styles.empty}>
        No containers or connections to map. Start some containers to see the network topology.
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div style={styles.header}>Network Map</div>
        <div style={styles.legend}>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: '#58a6ff' }} /> Container
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: '#30363d' }} /> Remote
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: '#f85149' }} /> Blocked
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: '#f0883e' }} /> Docker Net
          </span>
        </div>
      </div>
      <div ref={containerRef} style={styles.mapArea} />
      <details style={styles.details}>
        <summary style={styles.detailsSummary}>Mermaid Source</summary>
        <pre style={styles.code}>{mermaidCode}</pre>
      </details>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 16, marginBottom: 16,
  },
  headerRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  header: { fontSize: 14, fontWeight: 600, color: '#c9d1d9' },
  legend: { display: 'flex', gap: 12 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8b949e' },
  legendDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  mapArea: {
    background: '#0d1117', borderRadius: 8, padding: 16,
    minHeight: 300, overflow: 'auto',
    display: 'flex', justifyContent: 'center', alignItems: 'center',
  },
  empty: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 48, marginBottom: 16, textAlign: 'center', color: '#484f58', fontSize: 13,
  },
  details: { marginTop: 8 },
  detailsSummary: {
    cursor: 'pointer', fontSize: 11, color: '#484f58', padding: '4px 0',
  },
  code: {
    fontSize: 11, color: '#8b949e', background: '#0d1117', padding: 12,
    borderRadius: 6, overflow: 'auto', maxHeight: 200, marginTop: 4,
    whiteSpace: 'pre-wrap',
  },
}
