export interface Connection {
  id: string
  container: string
  container_ip: string
  remote_ip: string
  remote_domain?: string
  remote_port: number
  local_port: number
  protocol: string
  direction: string
  action: string
  bytes_sent: number
  bytes_recv: number
  start_time: string
  last_seen: string
  active: boolean
  country?: string
  country_code?: string
  city?: string
  isp?: string
  org?: string
  asn?: string
  category?: string // tailnet, gcp, mullvad, private, cloudflare, aws, azure, internet
  lat?: number
  lon?: number
}

export interface Container {
  id: string
  name: string
  image: string
  ip: string
}

export interface Rule {
  id?: number
  container_name: string
  direction: string
  remote_host: string
  remote_port: number
  protocol: string
  action: string
  priority: number
  enabled: boolean
  note: string
}

export interface WSEvent {
  type: 'connection_new' | 'connection_update' | 'connection_closed' | 'container_started' | 'container_stopped'
  data: Connection
}

export interface TorrentPeer {
  ip: string
  port: number
  client: string
  country: string
  country_code: string
  city: string
  isp: string
  org: string
  asn: string
  lat: number
  lon: number
  dl_speed: number
  up_speed: number
  downloaded: number
  uploaded: number
  progress: number
  flags: string
  connection: string
  torrent_name: string
  torrent_hash: string
}

export interface TorrentInfo {
  hash: string
  name: string
  state: string
  size: number
  dlspeed: number
  upspeed: number
  num_leechs: number
  num_seeds: number
  progress: number
  downloaded: number
  uploaded: number
}

export interface ServerLocation {
  ip: string
  geo: {
    country: string
    country_code: string
    city: string
    isp: string
    org: string
    as: string
    lat: number
    lon: number
  } | null
}

export interface Stats {
  active_connections: number
  containers: number
  per_container: Record<string, { connections: number; bytes_sent: number; bytes_recv: number }>
}

export interface LeakTestResult {
  status: 'secure' | 'leak' | 'warning' | 'no_torrent'
  server_ip: string
  mullvad_exits: string[]
  leaked_connections: LeakedConnection[]
  vpn_conn_count: number
  direct_conn_count: number
  checked_at: string
}

export interface LeakedConnection {
  container: string
  remote_ip: string
  remote_port: number
  domain: string
  country: string
  isp: string
  category: string
}
