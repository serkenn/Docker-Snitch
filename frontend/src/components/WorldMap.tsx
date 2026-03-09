import { useMemo, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet'
import type { Connection } from '../types'
import 'leaflet/dist/leaflet.css'

interface Props {
  connections: Connection[]
  serverLat?: number
  serverLon?: number
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
  digitalocean: '#0080ff',
  internet: '#58a6ff',
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
  digitalocean: 'DigitalOcean',
  internet: 'Internet',
  resolving: 'Resolving...',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`
  return `${(bytes / 1073741824).toFixed(1)}GB`
}

// Generate curved arc points between two coordinates
function arcPoints(
  from: [number, number],
  to: [number, number],
  segments = 30
): [number, number][] {
  const points: [number, number][] = []
  const dx = to[1] - from[1]
  const dy = to[0] - from[0]
  const dist = Math.sqrt(dx * dx + dy * dy)
  const curvature = Math.min(dist * 0.3, 15)

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const lat = from[0] + (to[0] - from[0]) * t
    const lon = from[1] + (to[1] - from[1]) * t
    const arc = Math.sin(t * Math.PI) * curvature
    // Offset perpendicular to the line
    const angle = Math.atan2(dy, dx)
    const offsetLat = -Math.sin(angle) * arc * 0.3
    const offsetLon = Math.cos(angle) * arc * 0.3
    points.push([lat + offsetLat, lon + offsetLon])
  }
  return points
}

// Auto-fit map bounds to markers
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  const fitted = useRef(false)

  useEffect(() => {
    if (points.length > 1 && !fitted.current) {
      const L = (window as any).L
      if (L) {
        const bounds = L.latLngBounds(points.map((p: [number, number]) => [p[0], p[1]]))
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 })
        fitted.current = true
      }
    }
  }, [points, map])

  return null
}

interface RemoteNode {
  lat: number
  lon: number
  label: string
  category: string
  country: string
  isp: string
  bytesSent: number
  bytesRecv: number
  count: number
  blocked: boolean
  containers: Set<string>
}

export function WorldMap({ connections, serverLat, serverLon }: Props) {
  const data = useMemo(() => {
    // Default server position (will be overridden if we detect it)
    const sLat = serverLat ?? 35.68
    const sLon = serverLon ?? 139.69

    // Group connections by remote endpoint location
    const remotes = new Map<string, RemoteNode>()

    for (const conn of connections) {
      if (!conn.lat || !conn.lon) continue
      if (conn.lat === 0 && conn.lon === 0) continue
      if (conn.category === 'private') continue

      const key = `${conn.lat.toFixed(2)},${conn.lon.toFixed(2)}`
      const existing = remotes.get(key)
      if (existing) {
        existing.bytesSent += conn.bytes_sent
        existing.bytesRecv += conn.bytes_recv
        existing.count++
        existing.containers.add(conn.container)
        if (conn.action === 'block') existing.blocked = true
        // Keep the more specific label
        if (!existing.label.includes('.') && (conn.remote_domain || conn.remote_ip).includes('.')) {
          existing.label = conn.remote_domain || conn.remote_ip
        }
      } else {
        remotes.set(key, {
          lat: conn.lat,
          lon: conn.lon,
          label: conn.remote_domain || conn.remote_ip,
          category: conn.category || 'internet',
          country: conn.country || '',
          isp: conn.isp || '',
          bytesSent: conn.bytes_sent,
          bytesRecv: conn.bytes_recv,
          count: 1,
          blocked: conn.action === 'block',
          containers: new Set([conn.container]),
        })
      }
    }

    const nodes = Array.from(remotes.values())
    const allPoints: [number, number][] = [[sLat, sLon]]
    nodes.forEach(n => allPoints.push([n.lat, n.lon]))

    return { sLat, sLon, nodes, allPoints }
  }, [connections, serverLat, serverLon])

  if (data.nodes.length === 0) {
    return (
      <div style={styles.empty}>
        No geo-located connections yet. Waiting for GeoIP resolution...
      </div>
    )
  }

  const maxBytes = Math.max(...data.nodes.map(n => n.bytesSent + n.bytesRecv), 1)

  return (
    <div style={styles.container}>
      <div style={styles.header}>World Traffic Map</div>
      <div style={styles.mapWrap}>
        <MapContainer
          center={[data.sLat, data.sLon]}
          zoom={3}
          style={{ height: '100%', width: '100%', background: '#0d1117', borderRadius: 8 }}
          zoomControl={true}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com">CARTO</a>'
          />

          <FitBounds points={data.allPoints} />

          {/* Server marker */}
          <CircleMarker
            center={[data.sLat, data.sLon]}
            radius={10}
            pathOptions={{
              color: '#58a6ff',
              fillColor: '#58a6ff',
              fillOpacity: 0.9,
              weight: 3,
            }}
          >
            <Popup>
              <div style={styles.popup}>
                <strong>Server</strong><br />
                {data.nodes.reduce((s, n) => s + n.count, 0)} connections
              </div>
            </Popup>
          </CircleMarker>

          {/* Arc lines from server to remotes */}
          {data.nodes.map((node, i) => {
            const color = node.blocked ? '#f85149' : (CATEGORY_COLORS[node.category] || '#58a6ff')
            const totalBytes = node.bytesSent + node.bytesRecv
            const weight = Math.max(1.5, Math.min(6, (totalBytes / maxBytes) * 6))
            const points = arcPoints(
              [data.sLat, data.sLon],
              [node.lat, node.lon]
            )
            return (
              <Polyline
                key={`arc-${i}`}
                positions={points}
                pathOptions={{
                  color,
                  weight,
                  opacity: node.blocked ? 0.5 : 0.6,
                  dashArray: node.blocked ? '6 4' : undefined,
                }}
              />
            )
          })}

          {/* Remote endpoint markers */}
          {data.nodes.map((node, i) => {
            const color = node.blocked ? '#f85149' : (CATEGORY_COLORS[node.category] || '#58a6ff')
            const totalBytes = node.bytesSent + node.bytesRecv
            const radius = Math.max(4, Math.min(14, (totalBytes / maxBytes) * 14))
            return (
              <CircleMarker
                key={`node-${i}`}
                center={[node.lat, node.lon]}
                radius={radius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.7,
                  weight: 2,
                }}
              >
                <Popup>
                  <div style={styles.popup}>
                    <strong>{node.label}</strong><br />
                    {node.country && <span>{node.country}<br /></span>}
                    {node.isp && <span style={{ color: '#8b949e' }}>{node.isp}<br /></span>}
                    <span style={{ color: CATEGORY_COLORS[node.category] || '#8b949e' }}>
                      {CATEGORY_LABELS[node.category] || node.category}
                    </span><br />
                    <span style={{ color: '#58a6ff' }}>
                      {formatBytes(totalBytes)} ({node.count} conn)
                    </span><br />
                    <span style={{ fontSize: 10, color: '#8b949e' }}>
                      Containers: {Array.from(node.containers).join(', ')}
                    </span>
                    {node.blocked && <><br /><span style={{ color: '#f85149' }}>BLOCKED</span></>}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        {Object.entries(CATEGORY_COLORS)
          .filter(([cat]) => data.nodes.some(n => n.category === cat))
          .map(([cat, color]) => (
            <div key={cat} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: color }} />
              <span style={styles.legendLabel}>
                {CATEGORY_LABELS[cat] || cat}
                <span style={styles.legendCount}>
                  {' '}({data.nodes.filter(n => n.category === cat).reduce((s, n) => s + n.count, 0)})
                </span>
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 16, marginBottom: 16,
  },
  header: { fontSize: 14, fontWeight: 600, color: '#c9d1d9', marginBottom: 12 },
  mapWrap: {
    height: 500, borderRadius: 8, overflow: 'hidden',
    border: '1px solid #30363d',
  },
  empty: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 48, textAlign: 'center', color: '#484f58', fontSize: 13,
  },
  popup: {
    fontSize: 12, lineHeight: 1.5, color: '#c9d1d9',
  },
  legend: {
    display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, padding: '8px 0',
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  legendDot: {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  },
  legendLabel: { fontSize: 11, color: '#8b949e' },
  legendCount: { color: '#484f58' },
}
