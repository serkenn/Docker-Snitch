import type { WSEvent } from '../types'

type Listener = (events: WSEvent[]) => void

export function createWSClient(onEvents: Listener) {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pendingEvents: WSEvent[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  // Throttle: flush events at most every 500ms to prevent UI jank
  function queueEvents(events: WSEvent[]) {
    pendingEvents.push(...events)
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        if (pendingEvents.length > 0) {
          onEvents(pendingEvents)
          pendingEvents = []
        }
        flushTimer = null
      }, 500)
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/api/ws`)

    ws.onmessage = (e) => {
      try {
        const events: WSEvent[] = JSON.parse(e.data)
        queueEvents(events)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return {
    close() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (flushTimer) clearTimeout(flushTimer)
      ws?.close()
    },
  }
}
