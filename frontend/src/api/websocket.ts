import type { WSEvent } from '../types'

type Listener = (events: WSEvent[]) => void

export function createWSClient(onEvents: Listener) {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/api/ws`)

    ws.onmessage = (e) => {
      try {
        const events: WSEvent[] = JSON.parse(e.data)
        onEvents(events)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      reconnectTimer = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return {
    close() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    },
  }
}
