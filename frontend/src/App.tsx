import { useState, useEffect, useCallback, useRef } from 'react'
import type { Connection, Container, Rule, WSEvent } from './types'
import { api } from './api/client'
import { createWSClient } from './api/websocket'
import { ConnectionTable } from './components/ConnectionTable'
import { ContainerList } from './components/ContainerList'
import { RuleList } from './components/RuleList'
import { RuleEditor } from './components/RuleEditor'
import { TrafficChart } from './components/TrafficChart'
import { NetworkMap } from './components/NetworkMap'
import { WorldMap } from './components/WorldMap'

type Tab = 'connections' | 'rules' | 'map' | 'worldmap'

export default function App() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [containers, setContainers] = useState<Container[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('connections')
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [showRuleEditor, setShowRuleEditor] = useState(false)
  const connectionsRef = useRef(connections)
  connectionsRef.current = connections

  // Initial data load
  useEffect(() => {
    api.getConnections().then(setConnections).catch(() => {})
    api.getContainers().then(setContainers).catch(() => {})
    api.getRules().then(setRules).catch(() => {})
  }, [])

  // Refresh containers periodically
  useEffect(() => {
    const id = setInterval(() => {
      api.getContainers().then(setContainers).catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // WebSocket for real-time updates
  const handleWSEvents = useCallback((events: WSEvent[]) => {
    setConnections(prev => {
      const map = new Map(prev.map(c => [c.id, c]))
      for (const event of events) {
        switch (event.type) {
          case 'connection_new':
            map.set(event.data.id, event.data)
            break
          case 'connection_update':
            if (map.has(event.data.id)) {
              map.set(event.data.id, { ...map.get(event.data.id)!, ...event.data })
            }
            break
          case 'connection_closed':
            map.delete(event.data.id)
            break
        }
      }
      return Array.from(map.values())
    })
  }, [])

  useEffect(() => {
    const ws = createWSClient(handleWSEvents)
    return () => ws.close()
  }, [handleWSEvents])

  // Filter connections by selected containers
  // Empty set = all containers (no filter)
  const filteredConnections = selectedContainers.size > 0
    ? connections.filter(c => selectedContainers.has(c.container))
    : connections

  const handleCreateRule = (prefill?: Partial<Rule>) => {
    setEditingRule({
      container_name: prefill?.container_name || '*',
      direction: prefill?.direction || 'both',
      remote_host: prefill?.remote_host || '*',
      remote_port: prefill?.remote_port || 0,
      protocol: prefill?.protocol || '*',
      action: prefill?.action || 'block',
      priority: 100,
      enabled: true,
      note: '',
    })
    setShowRuleEditor(true)
  }

  const handleSaveRule = async (rule: Rule) => {
    if (rule.id) {
      await api.updateRule(rule.id, rule)
    } else {
      await api.createRule(rule)
    }
    setShowRuleEditor(false)
    setEditingRule(null)
    api.getRules().then(setRules)
  }

  const handleDeleteRule = async (id: number) => {
    await api.deleteRule(id)
    api.getRules().then(setRules)
  }

  const handleBlockConnection = (conn: Connection) => {
    handleCreateRule({
      container_name: conn.container,
      remote_host: conn.remote_ip,
      remote_port: conn.remote_port,
      protocol: conn.protocol,
      direction: conn.direction,
      action: 'block',
    })
  }

  // Compute summary stats
  const totalBytes = filteredConnections.reduce(
    (acc, c) => ({ sent: acc.sent + c.bytes_sent, recv: acc.recv + c.bytes_recv }),
    { sent: 0, recv: 0 }
  )
  const selectionLabel = selectedContainers.size === 0
    ? 'All'
    : selectedContainers.size === 1
      ? Array.from(selectedContainers)[0]
      : `${selectedContainers.size} containers`

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>Docker Snitch</h1>
        <div style={styles.stats}>
          <span style={styles.stat}>
            {selectionLabel}: {filteredConnections.length} connections
          </span>
          <span style={styles.stat}>
            {formatBytes(totalBytes.sent)} sent / {formatBytes(totalBytes.recv)} recv
          </span>
          <span style={styles.stat}>{containers.length} containers</span>
        </div>
      </header>

      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          <ContainerList
            containers={containers}
            selectedContainers={selectedContainers}
            onSelectionChange={setSelectedContainers}
            connections={connections}
          />
        </aside>

        <main style={styles.main}>
          <div style={styles.tabs}>
            <button
              style={tab === 'connections' ? styles.tabActive : styles.tab}
              onClick={() => setTab('connections')}
            >
              Connections
            </button>
            <button
              style={tab === 'worldmap' ? styles.tabActive : styles.tab}
              onClick={() => setTab('worldmap')}
            >
              World Map
            </button>
            <button
              style={tab === 'map' ? styles.tabActive : styles.tab}
              onClick={() => setTab('map')}
            >
              Network Map
            </button>
            <button
              style={tab === 'rules' ? styles.tabActive : styles.tab}
              onClick={() => setTab('rules')}
            >
              Rules ({rules.length})
            </button>
            {tab === 'rules' && (
              <button style={styles.addBtn} onClick={() => handleCreateRule()}>
                + Add Rule
              </button>
            )}
          </div>

          {tab === 'connections' && (
            <>
              <TrafficChart connections={filteredConnections} />
              <ConnectionTable
                connections={filteredConnections}
                onBlock={handleBlockConnection}
              />
            </>
          )}

          {tab === 'worldmap' && (
            <WorldMap connections={filteredConnections} />
          )}

          {tab === 'map' && (
            <NetworkMap
              connections={filteredConnections}
              containers={
                selectedContainers.size > 0
                  ? containers.filter(c => selectedContainers.has(c.name))
                  : containers
              }
            />
          )}

          {tab === 'rules' && (
            <RuleList
              rules={rules}
              onEdit={(r) => { setEditingRule(r); setShowRuleEditor(true) }}
              onDelete={handleDeleteRule}
              onToggle={async (r) => {
                await api.updateRule(r.id!, { ...r, enabled: !r.enabled })
                api.getRules().then(setRules)
              }}
            />
          )}
        </main>
      </div>

      {showRuleEditor && editingRule && (
        <RuleEditor
          rule={editingRule}
          onSave={handleSaveRule}
          onCancel={() => { setShowRuleEditor(false); setEditingRule(null) }}
        />
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

const styles: Record<string, React.CSSProperties> = {
  app: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 24px', background: '#161b22', borderBottom: '1px solid #30363d',
  },
  title: { fontSize: 20, fontWeight: 600, color: '#58a6ff' },
  stats: { display: 'flex', gap: 16 },
  stat: { fontSize: 13, color: '#8b949e' },
  layout: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: {
    width: 260, background: '#0d1117', borderRight: '1px solid #30363d',
    overflowY: 'auto', padding: '12px 0',
  },
  main: { flex: 1, overflow: 'auto', padding: 16 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, alignItems: 'center' },
  tab: {
    padding: '8px 16px', background: 'transparent', border: '1px solid #30363d',
    borderRadius: 6, color: '#8b949e', cursor: 'pointer', fontSize: 13,
  },
  tabActive: {
    padding: '8px 16px', background: '#21262d', border: '1px solid #58a6ff',
    borderRadius: 6, color: '#58a6ff', cursor: 'pointer', fontSize: 13,
  },
  addBtn: {
    marginLeft: 'auto', padding: '6px 12px', background: '#238636',
    border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13,
  },
}
