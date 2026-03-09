import type { Connection, Container, Rule, Stats } from '../types'

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
  getConnections: () => fetchJSON<Connection[]>('/connections'),
  getContainers: () => fetchJSON<Container[]>('/containers'),
  getStats: () => fetchJSON<Stats>('/stats'),

  getRules: () => fetchJSON<Rule[]>('/rules'),
  createRule: (rule: Omit<Rule, 'id'>) =>
    fetchJSON<Rule>('/rules', { method: 'POST', body: JSON.stringify(rule) }),
  updateRule: (id: number, rule: Rule) =>
    fetchJSON<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(rule) }),
  deleteRule: (id: number) =>
    fetchJSON<void>(`/rules/${id}`, { method: 'DELETE' }),
}
