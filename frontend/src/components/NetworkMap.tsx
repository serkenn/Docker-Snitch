import { useMemo, useEffect, useRef, useState, useCallback } from 'react'
import type { Connection, Container } from '../types'

interface Props {
  connections: Connection[]
  containers: Container[]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`
  return `${(bytes / 1073741824).toFixed(1)}GB`
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

const CATEGORY_STYLES: Record<string, { stroke: string; fill: string; label: string }> = {
  tailnet:    { stroke: '#7c3aed', fill: '#1a0533', label: 'Tailnet' },
  gcp:        { stroke: '#4285f4', fill: '#0d1b33', label: 'Google Cloud' },
  mullvad:    { stroke: '#294a00', fill: '#0d1a00', label: 'Mullvad VPN' },
  private:    { stroke: '#484f58', fill: '#0d1117', label: 'Private/Local' },
  cloudflare: { stroke: '#f38020', fill: '#1a0f00', label: 'Cloudflare' },
  aws:        { stroke: '#ff9900', fill: '#1a0f00', label: 'AWS' },
  azure:      { stroke: '#0078d4', fill: '#001a33', label: 'Azure' },
  hetzner:    { stroke: '#d50c2d', fill: '#1a0008', label: 'Hetzner' },
  ovh:        { stroke: '#000e9c', fill: '#00011a', label: 'OVH' },
  internet:   { stroke: '#8b949e', fill: '#0d1117', label: 'Internet' },
  resolving:  { stroke: '#484f58', fill: '#0d1117', label: 'Resolving...' },
}

export function NetworkMap({ connections, containers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; startPanX: number; startPanY: number }>({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.min(5, Math.max(0.2, z * delta)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPan({ x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Aggregate data for the map
  const { mermaidCode, categorySummary } = useMemo(() => {
    if (connections.length === 0 && containers.length === 0) {
      return { mermaidCode: '', categorySummary: [] }
    }

    // Group connections by category
    const byCategory = new Map<string, {
      label: string
      remotes: Map<string, { label: string; bytes: number; count: number; country: string; isp: string; blocked: boolean }>
      totalBytes: number
      totalConns: number
    }>()

    // Aggregate edges: container -> remote, grouped by category
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
      category: string
      country: string
      isp: string
    }>()

    for (const conn of connections) {
      const cat = conn.category || 'internet'
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
          remoteLabel: truncate(remoteLabel, 22),
          protocol: conn.protocol,
          port: conn.remote_port,
          bytesSent: conn.bytes_sent,
          bytesRecv: conn.bytes_recv,
          action: conn.action,
          count: 1,
          category: cat,
          country: conn.country || '',
          isp: conn.isp || '',
        })
      }

      // Category summary
      if (!byCategory.has(cat)) {
        byCategory.set(cat, {
          label: CATEGORY_STYLES[cat]?.label || cat,
          remotes: new Map(),
          totalBytes: 0,
          totalConns: 0,
        })
      }
      const catData = byCategory.get(cat)!
      catData.totalBytes += conn.bytes_sent + conn.bytes_recv
      catData.totalConns++

      const remoteKey = remoteLabel
      if (!catData.remotes.has(remoteKey)) {
        catData.remotes.set(remoteKey, {
          label: remoteLabel,
          bytes: 0,
          count: 0,
          country: conn.country || '',
          isp: conn.isp || '',
          blocked: false,
        })
      }
      const remote = catData.remotes.get(remoteKey)!
      remote.bytes += conn.bytes_sent + conn.bytes_recv
      remote.count++
      if (conn.action === 'block') remote.blocked = true
    }

    // Build Mermaid with subgraphs per category
    const lines: string[] = ['graph LR']
    lines.push('  classDef container fill:#161b22,stroke:#58a6ff,color:#c9d1d9,stroke-width:2px')
    lines.push('  classDef blocked fill:#3d1116,stroke:#f85149,color:#f85149,stroke-width:2px')

    // Add category class defs
    for (const [cat, style] of Object.entries(CATEGORY_STYLES)) {
      lines.push(`  classDef cat_${cat} fill:${style.fill},stroke:${style.stroke},color:#c9d1d9,stroke-width:1px`)
    }

    // Container nodes
    const containerIds = new Set<string>()
    for (const c of containers) {
      const id = `C_${sanitize(c.name)}`
      containerIds.add(id)
      lines.push(`  ${id}["${truncate(c.name, 18)}<br/><small>${c.ip}</small>"]`)
      lines.push(`  class ${id} container`)
    }

    for (const edge of edges.values()) {
      const id = `C_${sanitize(edge.container)}`
      if (!containerIds.has(id)) {
        containerIds.add(id)
        lines.push(`  ${id}["${truncate(edge.container, 18)}"]`)
        lines.push(`  class ${id} container`)
      }
    }

    // Group remotes by category in subgraphs
    const remoteIds = new Set<string>()
    const addedSubgraphs = new Set<string>()

    for (const [cat, catData] of byCategory) {
      const style = CATEGORY_STYLES[cat] || CATEGORY_STYLES.internet
      const subgraphId = `sg_${sanitize(cat)}`

      if (!addedSubgraphs.has(cat)) {
        addedSubgraphs.add(cat)
        lines.push(`  subgraph ${subgraphId}["${style.label} - ${formatBytes(catData.totalBytes)}"]`)

        for (const edge of edges.values()) {
          if (edge.category !== cat) continue
          const remoteId = `R_${sanitize(edge.remote)}_${edge.port}`
          if (remoteIds.has(remoteId)) continue
          remoteIds.add(remoteId)

          const countryFlag = edge.country ? ` ${edge.country}` : ''
          const label = `${edge.remoteLabel}<br/><small>:${edge.port}${countryFlag}</small>`
          lines.push(`    ${remoteId}["${label}"]`)
          if (edge.action === 'block') {
            lines.push(`    class ${remoteId} blocked`)
          } else {
            lines.push(`    class ${remoteId} cat_${cat}`)
          }
        }

        lines.push('  end')
        // Style subgraph
        lines.push(`  style ${subgraphId} fill:${style.fill},stroke:${style.stroke},color:${style.stroke}`)
      }
    }

    // Add edges
    for (const edge of edges.values()) {
      const containerId = `C_${sanitize(edge.container)}`
      const remoteId = `R_${sanitize(edge.remote)}_${edge.port}`
      const total = formatBytes(edge.bytesSent + edge.bytesRecv)
      const label = edge.count > 1 ? `${total} x${edge.count}` : total

      if (edge.action === 'block') {
        lines.push(`  ${containerId} -.-x|"${label}"| ${remoteId}`)
      } else {
        lines.push(`  ${containerId} -->|"${label}"| ${remoteId}`)
      }
    }

    // Category summary for sidebar
    const categorySummary = Array.from(byCategory.entries())
      .map(([cat, data]) => ({
        category: cat,
        label: data.label,
        totalBytes: data.totalBytes,
        totalConns: data.totalConns,
        color: CATEGORY_STYLES[cat]?.stroke || '#8b949e',
        remotes: Array.from(data.remotes.values())
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 8),
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes)

    return { mermaidCode: lines.join('\n'), categorySummary }
  }, [connections, containers])

  // Render Mermaid
  useEffect(() => {
    if (!containerRef.current || !mermaidCode) return

    const renderMermaid = async () => {
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
        flowchart: { htmlLabels: true, curve: 'basis', padding: 12 },
        securityLevel: 'loose',
      })

      try {
        const id = 'network-map-' + Date.now()
        const { svg } = await mermaid.render(id, mermaidCode)
        if (containerRef.current) {
          containerRef.current.innerHTML = svg
          const svgEl = containerRef.current.querySelector('svg')
          if (svgEl) {
            svgEl.style.maxWidth = 'none'
            svgEl.style.height = 'auto'
          }
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
        if (containerRef.current) {
          containerRef.current.innerHTML = `<pre style="color:#f85149;font-size:12px">${String(err)}</pre>`
        }
      }
    }

    renderMermaid()
  }, [mermaidCode])

  if (!mermaidCode) {
    return (
      <div style={styles.empty}>
        No connections to map. Traffic data will appear here.
      </div>
    )
  }

  return (
    <div>
      {/* Traffic breakdown by category */}
      <div style={styles.summaryGrid}>
        {categorySummary.map(cat => (
          <div key={cat.category} style={{ ...styles.summaryCard, borderColor: cat.color }}>
            <div style={styles.summaryHeader}>
              <span style={{ ...styles.summaryDot, background: cat.color }} />
              <span style={styles.summaryLabel}>{cat.label}</span>
              <span style={styles.summaryBytes}>{formatBytes(cat.totalBytes)}</span>
              <span style={styles.summaryCount}>{cat.totalConns} conn</span>
            </div>
            <div style={styles.summaryRemotes}>
              {cat.remotes.map((r, i) => (
                <div key={i} style={styles.summaryRemoteRow}>
                  <span style={r.blocked ? styles.blockedRemote : styles.remoteText}>
                    {truncate(r.label, 28)}
                  </span>
                  {r.country && <span style={styles.remoteCountry}>{r.country}</span>}
                  {r.isp && <span style={styles.remoteIsp}>{truncate(r.isp, 18)}</span>}
                  <span style={styles.remoteBytes}>{formatBytes(r.bytes)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Mermaid diagram with pan/zoom */}
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <div style={styles.header}>Network Topology</div>
          <div style={styles.zoomControls}>
            <button style={styles.zoomBtn} onClick={() => setZoom(z => Math.min(5, z * 1.25))} title="Zoom in">+</button>
            <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
            <button style={styles.zoomBtn} onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} title="Zoom out">-</button>
            <button style={styles.resetBtn} onClick={resetView} title="Reset view">Reset</button>
          </div>
        </div>
        <div
          ref={wrapperRef}
          style={styles.mapArea}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            ref={containerRef}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: dragRef.current.dragging ? 'none' : 'transform 0.1s ease-out',
              cursor: dragRef.current.dragging ? 'grabbing' : 'grab',
              display: 'inline-block',
            }}
          />
        </div>
        <details style={styles.details}>
          <summary style={styles.detailsSummary}>Mermaid Source</summary>
          <pre style={styles.code}>{mermaidCode}</pre>
        </details>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  summaryGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 12, marginBottom: 16,
  },
  summaryCard: {
    background: '#161b22', border: '1px solid', borderRadius: 8, padding: 12,
  },
  summaryHeader: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  summaryDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  summaryLabel: { fontSize: 13, fontWeight: 600, color: '#c9d1d9', flex: 1 },
  summaryBytes: { fontSize: 12, color: '#58a6ff', fontWeight: 600 },
  summaryCount: { fontSize: 11, color: '#484f58' },
  summaryRemotes: { display: 'flex', flexDirection: 'column', gap: 2 },
  summaryRemoteRow: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '1px 0',
  },
  remoteText: { color: '#8b949e', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  blockedRemote: { color: '#f85149', flex: 1, textDecoration: 'line-through' },
  remoteCountry: { color: '#484f58', fontSize: 10, flexShrink: 0 },
  remoteIsp: { color: '#484f58', fontSize: 10, flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  remoteBytes: { color: '#58a6ff', fontSize: 10, flexShrink: 0, minWidth: 45, textAlign: 'right' as const },
  container: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 16, marginBottom: 16,
  },
  headerRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  header: { fontSize: 14, fontWeight: 600, color: '#c9d1d9' },
  zoomControls: { display: 'flex', alignItems: 'center', gap: 4 },
  zoomBtn: {
    width: 28, height: 28, background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
    color: '#c9d1d9', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  },
  zoomLabel: { fontSize: 11, color: '#484f58', minWidth: 40, textAlign: 'center' as const },
  resetBtn: {
    padding: '4px 10px', background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
    color: '#8b949e', fontSize: 11, cursor: 'pointer', marginLeft: 4,
  },
  mapArea: {
    background: '#0d1117', borderRadius: 8,
    height: 500, overflow: 'hidden', position: 'relative' as const,
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    userSelect: 'none' as const,
  },
  empty: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 48, marginBottom: 16, textAlign: 'center', color: '#484f58', fontSize: 13,
  },
  details: { marginTop: 8 },
  detailsSummary: { cursor: 'pointer', fontSize: 11, color: '#484f58', padding: '4px 0' },
  code: {
    fontSize: 11, color: '#8b949e', background: '#0d1117', padding: 12,
    borderRadius: 6, overflow: 'auto', maxHeight: 200, marginTop: 4,
    whiteSpace: 'pre-wrap' as const,
  },
}
