import type { Connection, Container, Rule, Stats, TorrentPeer, TorrentInfo } from '../types'

const BASE = '/api'

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  getConnections: () => fetchJSON<Connection[] | null>('/connections').then(r => r ?? []),
  getContainers: () => fetchJSON<Container[] | null>('/containers').then(r => r ?? []),
  getStats: () => fetchJSON<Stats>('/stats'),
  getPeers: () => fetchJSON<TorrentPeer[] | null>('/peers').then(r => r ?? []),
  getTorrents: () => fetchJSON<TorrentInfo[] | null>('/torrents').then(r => r ?? []),

  getRules: () => fetchJSON<Rule[] | null>('/rules').then(r => r ?? []),
  createRule: (rule: Omit<Rule, 'id'>) =>
    fetchJSON<Rule>('/rules', { method: 'POST', body: JSON.stringify(rule) }),
  updateRule: (id: number, rule: Rule) =>
    fetchJSON<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(rule) }),
  deleteRule: (id: number) =>
    fetchJSON<void>(`/rules/${id}`, { method: 'DELETE' }),
}
