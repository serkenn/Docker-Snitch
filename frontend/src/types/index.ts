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

export interface Stats {
  active_connections: number
  containers: number
  per_container: Record<string, { connections: number; bytes_sent: number; bytes_recv: number }>
}
