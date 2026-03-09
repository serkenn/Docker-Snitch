package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Event represents a WebSocket event
type Event struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// WSHub manages WebSocket connections and broadcasts events
type WSHub struct {
	clients map[*websocket.Conn]bool
	mu      sync.RWMutex
	batch   []Event
	batchMu sync.Mutex
}

// NewWSHub creates a new WebSocket hub
func NewWSHub() *WSHub {
	h := &WSHub{
		clients: make(map[*websocket.Conn]bool),
	}
	go h.batchLoop()
	return h
}

// HandleWS handles WebSocket upgrade requests
func (h *WSHub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()

	log.Printf("ws: client connected (%d total)", len(h.clients))

	// Read loop (just to detect disconnect)
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			conn.Close()
			log.Printf("ws: client disconnected (%d total)", len(h.clients))
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// Broadcast queues an event for batched broadcast
func (h *WSHub) Broadcast(event Event) {
	h.batchMu.Lock()
	h.batch = append(h.batch, event)
	h.batchMu.Unlock()
}

func (h *WSHub) batchLoop() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		h.batchMu.Lock()
		if len(h.batch) == 0 {
			h.batchMu.Unlock()
			continue
		}
		events := h.batch
		h.batch = nil
		h.batchMu.Unlock()

		data, err := json.Marshal(events)
		if err != nil {
			continue
		}

		h.mu.RLock()
		for conn := range h.clients {
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				conn.Close()
			}
		}
		h.mu.RUnlock()
	}
}
