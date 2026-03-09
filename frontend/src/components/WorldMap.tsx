import { useMemo, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, Tooltip, useMap } from 'react-leaflet'
import type { Connection, TorrentPeer, ServerLocation } from '../types'
import { api } from '../api/client'
import 'leaflet/dist/leaflet.css'

interface Props {
  connections: Connection[]
}

const CATEGORY_COLORS: Record<string, string> = {
  tailnet: '#7c3aed',
  gcp: '#4285f4',
  mullvad: '#59b300',
  private: '#484f58',
  cloudflare: '#f38020',
  aws: '#ff9900',
  azure: '#0078d4',
  hetzner: '#d50c2d',
  ovh: '#000e9c',
  digitalocean: '#0080ff',
  internet: '#58a6ff',
  resolving: '#484f58',
  peer: '#e8b004',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`
  return `${(bytes / 1073741824).toFixed(1)}GB`
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps} B/s`
  if (bps < 1048576) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1048576).toFixed(1)} MB/s`
}

// Generate curved arc points between two coordinates
function arcPoints(
  from: [number, number],
  to: [number, number],
  segments = 40
): [number, number][] {
  const points: [number, number][] = []
  const dx = to[1] - from[1]
  const dy = to[0] - from[0]
  const dist = Math.sqrt(dx * dx + dy * dy)
  const curvature = Math.min(dist * 0.2, 10)

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const lat = from[0] + (to[0] - from[0]) * t
    const lon = from[1] + (to[1] - from[1]) * t
    const arc = Math.sin(t * Math.PI) * curvature
    const angle = Math.atan2(dy, dx)
    const offsetLat = -Math.sin(angle) * arc * 0.3
    const offsetLon = Math.cos(angle) * arc * 0.3
    points.push([lat + offsetLat, lon + offsetLon])
  }
  return points
}

// Fit map bounds ONCE on first meaningful data, then never again
const fittedGlobal = { done: false }
function FitBoundsOnce({ points }: { points: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (points.length > 1 && !fittedGlobal.done) {
      const L = (window as any).L
      if (L) {
        const bounds = L.latLngBounds(points)
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5 })
        fittedGlobal.done = true
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally run once

  return null
}

// Aggregated node on the map
interface MapNode {
  lat: number
  lon: number
  label: string
  sublabel: string
  category: string
  color: string
  totalBytes: number
  count: number
  details: string[]
  role: 'server' | 'vpn-exit' | 'peer' | 'tailnet' | 'direct'
}

export function WorldMap({ connections }: Props) {
  const [peers, setPeers] = useState<TorrentPeer[]>([])
  const [serverLoc, setServerLoc] = useState<ServerLocation | null>(null)

  // Fetch server location once
  useEffect(() => {
    api.getServerLocation().then(setServerLoc).catch(() => {})
  }, [])

  // Poll peers every 5s
  useEffect(() => {
    let active = true
    const load = () => {
      api.getPeers().then(p => { if (active) setPeers(p) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 5000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const mapData = useMemo(() => {
    // Use server's actual location from API, fallback to 0,0
    let serverLat = serverLoc?.geo?.lat ?? 0
    let serverLon = serverLoc?.geo?.lon ?? 0
    const serverCity = serverLoc?.geo?.city ?? ''
    const serverCountry = serverLoc?.geo?.country ?? ''
    const serverIP = serverLoc?.ip ?? ''

    const nodes: MapNode[] = []
    const arcs: { from: [number, number]; to: [number, number]; color: string; weight: number; dash?: string; popupLines: string[] }[] = []
    const allPoints: [number, number][] = [[serverLat, serverLon]]

    // --- Mullvad VPN exit nodes (from NFQUEUE connections) ---
    const mullvadNodes = new Map<string, { lat: number; lon: number; bytes: number; count: number; ips: string[] }>()
    // --- Tailnet nodes ---
    const tailnetNodes = new Map<string, { lat: number; lon: number; bytes: number; count: number; label: string; ips: string[] }>()
    // --- Direct internet nodes ---
    const directNodes = new Map<string, { lat: number; lon: number; bytes: number; count: number; label: string; category: string; isp: string; country: string }>()

    for (const conn of connections) {
      if (!conn.lat || !conn.lon || (conn.lat === 0 && conn.lon === 0)) continue
      if (conn.category === 'private') continue

      if (conn.category === 'mullvad') {
        const key = `${conn.lat.toFixed(1)},${conn.lon.toFixed(1)}`
        const existing = mullvadNodes.get(key)
        if (existing) {
          existing.bytes += conn.bytes_sent + conn.bytes_recv
          existing.count++
          if (!existing.ips.includes(conn.remote_ip)) existing.ips.push(conn.remote_ip)
        } else {
          mullvadNodes.set(key, {
            lat: conn.lat, lon: conn.lon,
            bytes: conn.bytes_sent + conn.bytes_recv,
            count: 1,
            ips: [conn.remote_ip],
          })
        }
      } else if (conn.category === 'tailnet') {
        const key = conn.remote_ip
        const existing = tailnetNodes.get(key)
        if (existing) {
          existing.bytes += conn.bytes_sent + conn.bytes_recv
          existing.count++
        } else {
          tailnetNodes.set(key, {
            lat: conn.lat, lon: conn.lon,
            bytes: conn.bytes_sent + conn.bytes_recv,
            count: 1,
            label: conn.remote_domain || conn.remote_ip,
            ips: [conn.remote_ip],
          })
        }
      } else {
        const key = `${conn.lat.toFixed(2)},${conn.lon.toFixed(2)}`
        const existing = directNodes.get(key)
        if (existing) {
          existing.bytes += conn.bytes_sent + conn.bytes_recv
          existing.count++
        } else {
          directNodes.set(key, {
            lat: conn.lat, lon: conn.lon,
            bytes: conn.bytes_sent + conn.bytes_recv,
            count: 1,
            label: conn.remote_domain || conn.remote_ip,
            category: conn.category || 'internet',
            isp: conn.isp || '',
            country: conn.country || '',
          })
        }
      }
    }

    // --- Add Mullvad exit nodes ---
    const mullvadEntries = Array.from(mullvadNodes.entries())
    for (const [, m] of mullvadEntries) {
      nodes.push({
        lat: m.lat, lon: m.lon,
        label: 'Mullvad VPN Exit',
        sublabel: m.ips.join(', '),
        category: 'mullvad',
        color: CATEGORY_COLORS.mullvad,
        totalBytes: m.bytes,
        count: m.count,
        details: [`VPN Tunnel: ${formatBytes(m.bytes)}`, `${m.count} connections`],
        role: 'vpn-exit',
      })
      allPoints.push([m.lat, m.lon])

      // Arc: Server → Mullvad exit
      arcs.push({
        from: [serverLat, serverLon],
        to: [m.lat, m.lon],
        color: CATEGORY_COLORS.mullvad,
        weight: Math.max(3, Math.min(8, m.bytes / 1048576)),
        popupLines: [
          'GCP Server → Mullvad VPN Exit',
          `WireGuard Tunnel`,
          `Traffic: ${formatBytes(m.bytes)}`,
          `${m.count} connections`,
          `IPs: ${m.ips.join(', ')}`,
        ],
      })
    }

    // --- Add Torrent peers (connect to Mullvad exit, not directly to server) ---
    // Group peers by location
    const peerGroups = new Map<string, {
      lat: number; lon: number; downloaded: number; uploaded: number
      dlSpeed: number; upSpeed: number; count: number
      countries: Set<string>; clients: Set<string>; ips: string[]
    }>()

    for (const peer of peers) {
      if (!peer.lat || !peer.lon || (peer.lat === 0 && peer.lon === 0)) continue
      const key = `${peer.lat.toFixed(1)},${peer.lon.toFixed(1)}`
      const existing = peerGroups.get(key)
      if (existing) {
        existing.downloaded += peer.downloaded
        existing.uploaded += peer.uploaded
        existing.dlSpeed += peer.dl_speed
        existing.upSpeed += peer.up_speed
        existing.count++
        if (peer.country) existing.countries.add(peer.country)
        if (peer.client) existing.clients.add(peer.client.split('/')[0])
        if (existing.ips.length < 5) existing.ips.push(peer.ip)
      } else {
        peerGroups.set(key, {
          lat: peer.lat, lon: peer.lon,
          downloaded: peer.downloaded,
          uploaded: peer.uploaded,
          dlSpeed: peer.dl_speed,
          upSpeed: peer.up_speed,
          count: 1,
          countries: new Set(peer.country ? [peer.country] : []),
          clients: new Set(peer.client ? [peer.client.split('/')[0]] : []),
          ips: [peer.ip],
        })
      }
    }

    // Find main Mullvad exit to use as intermediate hop for peers
    let mullvadExitPos: [number, number] | null = null
    if (mullvadEntries.length > 0) {
      const main = mullvadEntries.sort((a, b) => b[1].bytes - a[1].bytes)[0][1]
      mullvadExitPos = [main.lat, main.lon]
    }

    for (const [, pg] of peerGroups) {
      const totalBytes = pg.downloaded + pg.uploaded
      const countries = Array.from(pg.countries).join(', ')
      nodes.push({
        lat: pg.lat, lon: pg.lon,
        label: pg.count === 1 ? pg.ips[0] : `${pg.count} peers`,
        sublabel: countries,
        category: 'peer',
        color: CATEGORY_COLORS.peer,
        totalBytes,
        count: pg.count,
        details: [
          countries,
          `DL: ${formatBytes(pg.downloaded)} (${formatSpeed(pg.dlSpeed)})`,
          `UL: ${formatBytes(pg.uploaded)} (${formatSpeed(pg.upSpeed)})`,
          `${pg.count} peer${pg.count > 1 ? 's' : ''}`,
          ...(pg.ips.length <= 3 ? pg.ips : [...pg.ips.slice(0, 3), `+${pg.ips.length - 3} more`]),
        ],
        role: 'peer',
      })
      allPoints.push([pg.lat, pg.lon])

      // Arc: Mullvad exit → peer (or server → peer if no mullvad)
      const origin = mullvadExitPos || [serverLat, serverLon] as [number, number]
      arcs.push({
        from: origin,
        to: [pg.lat, pg.lon],
        color: CATEGORY_COLORS.peer,
        weight: Math.max(1, Math.min(4, (totalBytes / 1048576) * 0.5)),
        dash: pg.dlSpeed > 0 ? undefined : '4 4',
        popupLines: [
          mullvadExitPos ? 'Mullvad VPN → Torrent Peer' : 'Server → Torrent Peer',
          countries,
          `DL: ${formatBytes(pg.downloaded)} (${formatSpeed(pg.dlSpeed)})`,
          `UL: ${formatBytes(pg.uploaded)} (${formatSpeed(pg.upSpeed)})`,
          `${pg.count} peer${pg.count > 1 ? 's' : ''}`,
          ...(pg.ips.length <= 3 ? pg.ips : [...pg.ips.slice(0, 3), `+${pg.ips.length - 3} more`]),
        ].filter(Boolean),
      })
    }

    // --- Add Tailnet nodes ---
    for (const [, t] of tailnetNodes) {
      nodes.push({
        lat: t.lat, lon: t.lon,
        label: t.label,
        sublabel: 'Tailnet',
        category: 'tailnet',
        color: CATEGORY_COLORS.tailnet,
        totalBytes: t.bytes,
        count: t.count,
        details: [`${formatBytes(t.bytes)}`, `${t.count} connections`],
        role: 'tailnet',
      })
      allPoints.push([t.lat, t.lon])

      arcs.push({
        from: [serverLat, serverLon],
        to: [t.lat, t.lon],
        color: CATEGORY_COLORS.tailnet,
        weight: Math.max(2, Math.min(6, t.bytes / 1048576)),
        popupLines: [
          `GCP Server → ${t.label}`,
          'Tailscale WireGuard',
          `Traffic: ${formatBytes(t.bytes)}`,
          `${t.count} connections`,
        ],
      })
    }

    // --- Add Direct internet nodes ---
    for (const [, d] of directNodes) {
      const color = CATEGORY_COLORS[d.category] || CATEGORY_COLORS.internet
      nodes.push({
        lat: d.lat, lon: d.lon,
        label: d.label,
        sublabel: [d.country, d.isp].filter(Boolean).join(' - '),
        category: d.category,
        color,
        totalBytes: d.bytes,
        count: d.count,
        details: [d.country, d.isp, `${formatBytes(d.bytes)}`, `${d.count} conn`].filter(Boolean),
        role: 'direct',
      })
      allPoints.push([d.lat, d.lon])

      arcs.push({
        from: [serverLat, serverLon],
        to: [d.lat, d.lon],
        color,
        weight: Math.max(1.5, Math.min(5, d.bytes / 1048576)),
        popupLines: [
          `GCP Server → ${d.label}`,
          [d.country, d.isp].filter(Boolean).join(' - '),
          `Traffic: ${formatBytes(d.bytes)}`,
          `${d.count} connections`,
        ].filter(Boolean),
      })
    }

    // Stats summary
    const totalPeers = peers.length
    const totalDl = peers.reduce((s, p) => s + p.downloaded, 0)
    const totalUl = peers.reduce((s, p) => s + p.uploaded, 0)
    const totalDlSpeed = peers.reduce((s, p) => s + p.dl_speed, 0)
    const totalUlSpeed = peers.reduce((s, p) => s + p.up_speed, 0)

    return { serverLat, serverLon, serverCity, serverCountry, serverIP, nodes, arcs, allPoints, totalPeers, totalDl, totalUl, totalDlSpeed, totalUlSpeed }
  }, [connections, peers, serverLoc])

  if (mapData.nodes.length === 0 && peers.length === 0) {
    return (
      <div style={styles.empty}>
        No geo-located connections yet. Waiting for data...
      </div>
    )
  }

  // Count by role for legend
  const roleCounts = {
    'vpn-exit': mapData.nodes.filter(n => n.role === 'vpn-exit').length,
    peer: mapData.nodes.filter(n => n.role === 'peer').length,
    tailnet: mapData.nodes.filter(n => n.role === 'tailnet').length,
    direct: mapData.nodes.filter(n => n.role === 'direct').length,
  }

  return (
    <div>
      {/* Stats bar */}
      <div style={styles.statsBar}>
        <div style={styles.statCard}>
          <span style={{ ...styles.statDot, background: CATEGORY_COLORS.peer }} />
          <div>
            <div style={styles.statValue}>{mapData.totalPeers} peers</div>
            <div style={styles.statLabel}>Torrent Swarm</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <span style={{ ...styles.statDot, background: '#3fb950' }} />
          <div>
            <div style={styles.statValue}>{formatSpeed(mapData.totalDlSpeed)}</div>
            <div style={styles.statLabel}>Download ({formatBytes(mapData.totalDl)})</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <span style={{ ...styles.statDot, background: '#f0883e' }} />
          <div>
            <div style={styles.statValue}>{formatSpeed(mapData.totalUlSpeed)}</div>
            <div style={styles.statLabel}>Upload ({formatBytes(mapData.totalUl)})</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <span style={{ ...styles.statDot, background: CATEGORY_COLORS.mullvad }} />
          <div>
            <div style={styles.statValue}>{roleCounts['vpn-exit']} exit{roleCounts['vpn-exit'] !== 1 ? 's' : ''}</div>
            <div style={styles.statLabel}>Mullvad VPN</div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div style={styles.container}>
        <div style={styles.header}>
          Network Topology
          <span style={styles.headerSub}>
            {' '}— Peers → Mullvad → GCP → Tailnet
          </span>
        </div>
        <div style={styles.mapWrap}>
          <MapContainer
            center={[mapData.serverLat, mapData.serverLon]}
            zoom={3}
            style={{ height: '100%', width: '100%', background: '#0d1117', borderRadius: 8 }}
            zoomControl={true}
            attributionControl={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; CARTO'
            />

            <FitBoundsOnce points={mapData.allPoints} />

            {/* Arc lines - clickable with popup */}
            {mapData.arcs.map((arc, i) => (
              <Polyline
                key={`arc-${i}`}
                positions={arcPoints(arc.from, arc.to)}
                pathOptions={{
                  color: arc.color,
                  weight: arc.weight,
                  opacity: 0.55,
                  dashArray: arc.dash,
                }}
                eventHandlers={{ mouseover: (e) => { e.target.setStyle({ opacity: 0.9, weight: arc.weight + 2 }) }, mouseout: (e) => { e.target.setStyle({ opacity: 0.55, weight: arc.weight }) } }}
              >
                <Popup>
                  <div style={styles.popup}>
                    {arc.popupLines.map((line, j) => (
                      <span key={j} style={j === 0 ? { fontWeight: 700, color: arc.color } : undefined}>
                        {line}<br />
                      </span>
                    ))}
                  </div>
                </Popup>
              </Polyline>
            ))}

            {/* Server marker (GCP) */}
            <CircleMarker
              center={[mapData.serverLat, mapData.serverLon]}
              radius={12}
              pathOptions={{
                color: CATEGORY_COLORS.gcp,
                fillColor: CATEGORY_COLORS.gcp,
                fillOpacity: 0.9,
                weight: 3,
              }}
            >
              <Tooltip direction="top" permanent className="server-tooltip">
                <span style={{ fontWeight: 700, fontSize: 11 }}>GCP Server</span>
              </Tooltip>
              <Popup>
                <div style={styles.popup}>
                  <strong style={{ color: CATEGORY_COLORS.gcp }}>GCP Server</strong><br />
                  {mapData.serverCity && mapData.serverCountry && <span>{mapData.serverCity}, {mapData.serverCountry}<br /></span>}
                  {mapData.serverIP && <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mapData.serverIP}<br /></span>}
                  {mapData.nodes.length} endpoints visible
                </div>
              </Popup>
            </CircleMarker>

            {/* All other nodes */}
            {mapData.nodes.map((node, i) => {
              const maxBytes = Math.max(...mapData.nodes.map(n => n.totalBytes), 1)
              let radius: number
              if (node.role === 'vpn-exit') {
                radius = 10
              } else if (node.role === 'peer') {
                radius = Math.max(3, Math.min(10, (node.totalBytes / maxBytes) * 10))
              } else {
                radius = Math.max(5, Math.min(10, (node.totalBytes / maxBytes) * 10))
              }

              return (
                <CircleMarker
                  key={`node-${i}`}
                  center={[node.lat, node.lon]}
                  radius={radius}
                  pathOptions={{
                    color: node.color,
                    fillColor: node.color,
                    fillOpacity: node.role === 'vpn-exit' ? 0.9 : 0.65,
                    weight: node.role === 'vpn-exit' ? 3 : 1.5,
                  }}
                >
                  {node.role === 'vpn-exit' && (
                    <Tooltip direction="top" permanent>
                      <span style={{ fontWeight: 600, fontSize: 10 }}>Mullvad</span>
                    </Tooltip>
                  )}
                  <Popup>
                    <div style={styles.popup}>
                      <strong style={{ color: node.color }}>{node.label}</strong><br />
                      {node.details.map((d, j) => (
                        <span key={j}>{d}<br /></span>
                      ))}
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>
        </div>

        {/* Legend */}
        <div style={styles.legend}>
          {[
            { color: CATEGORY_COLORS.gcp, label: 'GCP Server', count: 1 },
            ...(roleCounts['vpn-exit'] > 0 ? [{ color: CATEGORY_COLORS.mullvad, label: 'Mullvad VPN Exit', count: roleCounts['vpn-exit'] }] : []),
            ...(roleCounts.peer > 0 ? [{ color: CATEGORY_COLORS.peer, label: 'Torrent Peers', count: mapData.totalPeers }] : []),
            ...(roleCounts.tailnet > 0 ? [{ color: CATEGORY_COLORS.tailnet, label: 'Tailnet', count: roleCounts.tailnet }] : []),
            ...(roleCounts.direct > 0 ? [{ color: CATEGORY_COLORS.internet, label: 'Direct', count: roleCounts.direct }] : []),
          ].map((item, i) => (
            <div key={i} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: item.color }} />
              <span style={styles.legendLabel}>
                {item.label}
                <span style={styles.legendCount}> ({item.count})</span>
              </span>
            </div>
          ))}
          <div style={styles.legendItem}>
            <span style={styles.legendLine} />
            <span style={styles.legendLabel}>Active transfer</span>
          </div>
          <div style={styles.legendItem}>
            <span style={styles.legendLineDash} />
            <span style={styles.legendLabel}>Idle (0 DL/UL)</span>
          </div>
          <div style={styles.legendItem}>
            <span style={styles.legendLineRed} />
            <span style={styles.legendLabel}>Blocked</span>
          </div>
        </div>
      </div>

      {/* Peer table */}
      {peers.length > 0 && <PeerTable peers={peers} />}
    </div>
  )
}

function PeerTable({ peers }: { peers: TorrentPeer[] }) {
  const sorted = [...peers].sort((a, b) => (b.downloaded + b.uploaded) - (a.downloaded + a.uploaded))
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? sorted : sorted.slice(0, 50)

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Torrent Peers
        <span style={styles.headerSub}> — {peers.length} peers active</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>IP</th>
              <th style={styles.th}>Country</th>
              <th style={styles.th}>City</th>
              <th style={styles.th}>ISP</th>
              <th style={styles.th}>Client</th>
              <th style={styles.th}>DL Speed</th>
              <th style={styles.th}>UL Speed</th>
              <th style={styles.th}>Downloaded</th>
              <th style={styles.th}>Uploaded</th>
              <th style={styles.th}>Progress</th>
              <th style={styles.th}>Torrent</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((peer, i) => (
              <tr key={`${peer.ip}-${peer.port}-${i}`}>
                <td style={styles.td}>
                  <span style={{ color: '#c9d1d9', fontFamily: 'monospace', fontSize: 11 }}>{peer.ip}</span>
                </td>
                <td style={styles.td}>
                  {flagEmoji(peer.country_code)}{' '}
                  {peer.country}
                </td>
                <td style={styles.td}><span style={{ color: '#8b949e' }}>{peer.city}</span></td>
                <td style={styles.td}>
                  <span style={{ color: '#8b949e', fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', whiteSpace: 'nowrap' }}>
                    {peer.isp || peer.org}
                  </span>
                </td>
                <td style={styles.td}><span style={{ color: '#8b949e', fontSize: 11 }}>{peer.client}</span></td>
                <td style={styles.td}>
                  <span style={{ color: peer.dl_speed > 0 ? '#3fb950' : '#484f58' }}>
                    {formatSpeed(peer.dl_speed)}
                  </span>
                </td>
                <td style={styles.td}>
                  <span style={{ color: peer.up_speed > 0 ? '#f0883e' : '#484f58' }}>
                    {formatSpeed(peer.up_speed)}
                  </span>
                </td>
                <td style={styles.td}><span style={{ color: '#58a6ff' }}>{formatBytes(peer.downloaded)}</span></td>
                <td style={styles.td}><span style={{ color: '#f0883e' }}>{formatBytes(peer.uploaded)}</span></td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 40, height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${(peer.progress * 100).toFixed(0)}%`, height: '100%', background: '#3fb950', borderRadius: 2 }} />
                    </div>
                    <span style={{ color: '#484f58', fontSize: 10 }}>{(peer.progress * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td style={styles.td}>
                  <span style={{ color: '#8b949e', fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', whiteSpace: 'nowrap' }}>
                    {peer.torrent_name}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 50 && !showAll && (
        <button style={styles.showAllBtn} onClick={() => setShowAll(true)}>
          Show all {sorted.length} peers
        </button>
      )}
    </div>
  )
}

function flagEmoji(code?: string): string {
  if (!code || code.length !== 2) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
}

const styles: Record<string, React.CSSProperties> = {
  statsBar: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 10, marginBottom: 12,
  },
  statCard: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px',
  },
  statDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  statValue: { fontSize: 14, fontWeight: 700, color: '#c9d1d9' },
  statLabel: { fontSize: 11, color: '#484f58' },
  container: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 16, marginBottom: 16,
  },
  header: { fontSize: 14, fontWeight: 600, color: '#c9d1d9', marginBottom: 12 },
  headerSub: { fontSize: 12, fontWeight: 400, color: '#484f58' },
  mapWrap: {
    height: 520, borderRadius: 8, overflow: 'hidden',
    border: '1px solid #30363d',
  },
  empty: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    padding: 48, textAlign: 'center', color: '#484f58', fontSize: 13,
  },
  popup: {
    fontSize: 12, lineHeight: 1.6, color: '#c9d1d9',
  },
  legend: {
    display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12, padding: '8px 0',
  },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  legendLabel: { fontSize: 11, color: '#8b949e' },
  legendCount: { color: '#484f58' },
  legendLine: { width: 20, height: 2, background: '#8b949e', borderRadius: 1, flexShrink: 0 },
  legendLineDash: { width: 20, height: 0, borderTop: '2px dashed #8b949e', flexShrink: 0 },
  legendLineRed: { width: 20, height: 0, borderTop: '2px dashed #f85149', flexShrink: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #30363d',
    color: '#8b949e', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap',
  },
  td: { padding: '3px 8px', borderBottom: '1px solid #21262d', whiteSpace: 'nowrap' },
  showAllBtn: {
    display: 'block', margin: '12px auto 0', padding: '6px 16px',
    background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
    color: '#8b949e', cursor: 'pointer', fontSize: 12,
  },
}
