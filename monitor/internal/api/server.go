package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/serken/docker-snitch/internal/capture"
	"github.com/serken/docker-snitch/internal/conntrack"
	"github.com/serken/docker-snitch/internal/containers"
	"github.com/serken/docker-snitch/internal/qbit"
	"github.com/serken/docker-snitch/internal/rules"
)

// Server provides the HTTP API
type Server struct {
	port      int
	capture   *capture.NFQueueCapture
	resolver  *containers.Resolver
	ruleStore *rules.Store
	engine    *rules.Engine
	hub       *WSHub
	qbit      *qbit.Client
	geo       *conntrack.GeoResolver
	hostConns map[string]*capture.Connection
	hostMu    sync.RWMutex
}

// NewServer creates a new API server
func NewServer(port int, cap *capture.NFQueueCapture, resolver *containers.Resolver, ruleStore *rules.Store, engine *rules.Engine, hub *WSHub, qbitClient *qbit.Client, geo *conntrack.GeoResolver) *Server {
	return &Server{
		port:      port,
		capture:   cap,
		resolver:  resolver,
		ruleStore: ruleStore,
		engine:    engine,
		hub:       hub,
		qbit:      qbitClient,
		geo:       geo,
		hostConns: make(map[string]*capture.Connection),
	}
}

// Start begins serving HTTP requests
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/connections", s.handleConnections)
	mux.HandleFunc("/api/containers", s.handleContainers)
	mux.HandleFunc("/api/rules", s.handleRules)
	mux.HandleFunc("/api/rules/", s.handleRuleByID)
	mux.HandleFunc("/api/stats", s.handleStats)
	mux.HandleFunc("/api/peers", s.handlePeers)
	mux.HandleFunc("/api/torrents", s.handleTorrents)
	mux.HandleFunc("/api/server-location", s.handleServerLocation)
	mux.HandleFunc("/api/host-events", s.handleHostEvents)
	mux.HandleFunc("/api/leak-test", s.handleLeakTest)
	mux.HandleFunc("/api/ws", s.hub.HandleWS)

	// CORS middleware
	handler := corsMiddleware(mux)

	addr := fmt.Sprintf(":%d", s.port)
	log.Printf("api: listening on %s", addr)
	return http.ListenAndServe(addr, handler)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleConnections(w http.ResponseWriter, r *http.Request) {
	conns := s.capture.GetConnections()
	if conns == nil {
		conns = make([]*capture.Connection, 0)
	}

	// Append host connections
	s.hostMu.RLock()
	for _, hc := range s.hostConns {
		cp := *hc
		conns = append(conns, &cp)
	}
	s.hostMu.RUnlock()

	writeJSON(w, conns)
}

func (s *Server) handleContainers(w http.ResponseWriter, r *http.Request) {
	result := s.resolver.GetContainers()
	if result == nil {
		result = make([]*containers.ContainerInfo, 0)
	}
	writeJSON(w, result)
}

func (s *Server) handleRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		ruleList, err := s.ruleStore.List()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if ruleList == nil {
			ruleList = []rules.Rule{}
		}
		writeJSON(w, ruleList)

	case "POST":
		var rule rules.Rule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		if err := validateRule(&rule); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := s.ruleStore.Create(&rule); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		s.engine.Reload()
		w.WriteHeader(201)
		writeJSON(w, rule)

	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleRuleByID(w http.ResponseWriter, r *http.Request) {
	// Extract ID from path: /api/rules/123
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/rules/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "missing rule ID", 400)
		return
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "invalid rule ID", 400)
		return
	}

	switch r.Method {
	case "GET":
		rule, err := s.ruleStore.Get(id)
		if err != nil {
			http.Error(w, "not found", 404)
			return
		}
		writeJSON(w, rule)

	case "PUT":
		var rule rules.Rule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		rule.ID = id
		if err := validateRule(&rule); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := s.ruleStore.Update(&rule); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		s.engine.Reload()
		writeJSON(w, rule)

	case "DELETE":
		if err := s.ruleStore.Delete(id); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		s.engine.Reload()
		w.WriteHeader(204)

	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	conns := s.capture.GetConnections()
	stats := map[string]interface{}{
		"active_connections": len(conns),
		"containers":        len(s.resolver.GetContainers()),
	}

	// Aggregate per container
	perContainer := make(map[string]map[string]uint64)
	for _, c := range conns {
		if _, ok := perContainer[c.ContainerName]; !ok {
			perContainer[c.ContainerName] = map[string]uint64{
				"connections": 0,
				"bytes_sent":  0,
				"bytes_recv":  0,
			}
		}
		perContainer[c.ContainerName]["connections"]++
		perContainer[c.ContainerName]["bytes_sent"] += c.BytesSent
		perContainer[c.ContainerName]["bytes_recv"] += c.BytesRecv
	}
	stats["per_container"] = perContainer

	writeJSON(w, stats)
}

func (s *Server) handlePeers(w http.ResponseWriter, r *http.Request) {
	if s.qbit == nil || !s.qbit.IsConfigured() {
		writeJSON(w, []struct{}{})
		return
	}
	peers, err := s.qbit.GetAllPeers()
	if err != nil {
		log.Printf("api: peers error: %v", err)
		writeJSON(w, []struct{}{})
		return
	}
	if peers == nil {
		peers = make([]qbit.Peer, 0)
	}
	writeJSON(w, peers)
}

func (s *Server) handleTorrents(w http.ResponseWriter, r *http.Request) {
	if s.qbit == nil || !s.qbit.IsConfigured() {
		writeJSON(w, []struct{}{})
		return
	}
	torrents, err := s.qbit.GetTorrents()
	if err != nil {
		log.Printf("api: torrents error: %v", err)
		writeJSON(w, []struct{}{})
		return
	}
	if torrents == nil {
		torrents = make([]qbit.TorrentInfo, 0)
	}
	writeJSON(w, torrents)
}

// hostEvent is the JSON format sent by the host agent
type hostEvent struct {
	Protocol  string `json:"protocol"`
	SrcIP     string `json:"src_ip"`
	DstIP     string `json:"dst_ip"`
	SrcPort   uint16 `json:"src_port"`
	DstPort   uint16 `json:"dst_port"`
	BytesSent uint64 `json:"bytes_sent"`
	BytesRecv uint64 `json:"bytes_recv"`
	State     string `json:"state"`
	Process   string `json:"process"`
}

func (s *Server) handleHostEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", 405)
		return
	}

	var events []hostEvent
	if err := json.NewDecoder(r.Body).Decode(&events); err != nil {
		http.Error(w, "invalid JSON", 400)
		return
	}

	s.hostMu.Lock()
	for _, ev := range events {
		// Skip private/loopback traffic and monitor's own traffic
		srcIP := net.ParseIP(ev.SrcIP)
		if srcIP == nil {
			continue
		}
		if srcIP.IsLoopback() {
			continue
		}
		// Skip monitor ports
		if ev.SrcPort == 9645 || ev.DstPort == 9645 || ev.SrcPort == 9080 || ev.DstPort == 9080 {
			continue
		}

		key := fmt.Sprintf("host|%s|%s:%d->%s:%d", ev.Protocol, ev.SrcIP, ev.SrcPort, ev.DstIP, ev.DstPort)

		conn, exists := s.hostConns[key]
		if !exists {
			// Determine direction: if src is a local IP, it's outbound
			direction := "outbound"
			remoteIP := ev.DstIP
			remotePort := ev.DstPort
			containerIP := ev.SrcIP
			if srcIP != nil && !isLocalIP(srcIP) {
				direction = "inbound"
				remoteIP = ev.SrcIP
				remotePort = ev.SrcPort
				containerIP = ev.DstIP
			}

			procName := ev.Process
			if procName == "" {
				procName = "host"
			}

			conn = &capture.Connection{
				ID:            key,
				ContainerName: fmt.Sprintf("[%s]", procName),
				ContainerIP:   containerIP,
				RemoteIP:      remoteIP,
				RemotePort:    remotePort,
				LocalPort:     ev.SrcPort,
				Protocol:      ev.Protocol,
				Direction:     direction,
				Action:        "allow",
				BytesSent:     ev.BytesSent,
				BytesRecv:     ev.BytesRecv,
				StartTime:     time.Now(),
				LastSeen:      time.Now(),
				Active:        true,
			}

			// GeoIP resolve
			if geo := s.geo.Lookup(remoteIP); geo != nil && geo.Category != "resolving" {
				conn.Country = geo.Country
				conn.CountryCode = geo.CountryCode
				conn.City = geo.City
				conn.ISP = geo.ISP
				conn.Org = geo.Org
				conn.ASN = geo.AS
				conn.Category = geo.Category
				conn.Lat = geo.Lat
				conn.Lon = geo.Lon
			}

			// Override category for Tailscale daemon connections —
			// tailscaled's WireGuard traffic goes to real public IPs but is Tailnet traffic
			if isTailscaleProcess(procName) {
				conn.Category = "tailnet"
				conn.Org = "Tailscale WireGuard"
				conn.ISP = "Tailscale"
			}

			s.hostConns[key] = conn

			// Broadcast new event
			connCopy := *conn
			s.hub.Broadcast(Event{Type: "connection_new", Data: &connCopy})
		} else {
			changed := conn.BytesSent != ev.BytesSent || conn.BytesRecv != ev.BytesRecv
			conn.BytesSent = ev.BytesSent
			conn.BytesRecv = ev.BytesRecv
			conn.LastSeen = time.Now()
			conn.Active = true

			// Re-enrich if still resolving or tailnet missing geo coords
			needsGeo := conn.Category == "" || conn.Category == "resolving"
			needsCoords := conn.Lat == 0 && conn.Lon == 0 && conn.Category == "tailnet"
			if needsGeo || needsCoords {
				if geo := s.geo.GetCachedInfo(conn.RemoteIP); geo != nil {
					conn.Country = geo.Country
					conn.CountryCode = geo.CountryCode
					conn.City = geo.City
					conn.Lat = geo.Lat
					conn.Lon = geo.Lon
					if needsGeo {
						// Full re-enrich: update ISP/Org/Category
						conn.ISP = geo.ISP
						conn.Org = geo.Org
						conn.ASN = geo.AS
						conn.Category = geo.Category
					}
					// Preserve tailnet override for tailscaled connections
					if isTailscaleProcess(strings.Trim(conn.ContainerName, "[]")) {
						conn.Category = "tailnet"
						conn.Org = "Tailscale WireGuard"
						conn.ISP = "Tailscale"
					}
				}
			}

			if changed {
				connCopy := *conn
				s.hub.Broadcast(Event{Type: "connection_update", Data: &connCopy})
			}
		}
	}

	// Clean up stale host connections (not seen in 30s)
	now := time.Now()
	for key, conn := range s.hostConns {
		if now.Sub(conn.LastSeen) > 30*time.Second {
			conn.Active = false
			connCopy := *conn
			s.hub.Broadcast(Event{Type: "connection_closed", Data: &connCopy})
			delete(s.hostConns, key)
		}
	}
	s.hostMu.Unlock()

	w.WriteHeader(200)
	writeJSON(w, map[string]int{"accepted": len(events)})
}

func isTailscaleProcess(name string) bool {
	lower := strings.ToLower(name)
	return lower == "tailscaled" || lower == "tailscale" || strings.HasPrefix(lower, "tailscale")
}

func isLocalIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return true
	}
	// Tailscale CGNAT range
	_, tailnet, _ := net.ParseCIDR("100.64.0.0/10")
	if tailnet.Contains(ip) {
		return true
	}
	return false
}

func (s *Server) handleServerLocation(w http.ResponseWriter, r *http.Request) {
	loc := s.geo.GetServerLocation()
	if loc == nil {
		writeJSON(w, map[string]interface{}{"ip": "", "geo": nil})
		return
	}
	writeJSON(w, loc)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// LeakTestResult holds the torrent VPN leak test result
type LeakTestResult struct {
	Status            string       `json:"status"` // secure, leak, warning, no_torrent
	ServerIP          string       `json:"server_ip"`
	MullvadExits      []string     `json:"mullvad_exits"`
	LeakedConnections []LeakedConn `json:"leaked_connections"`
	VPNConnCount      int          `json:"vpn_conn_count"`
	DirectConnCount   int          `json:"direct_conn_count"`
	CheckedAt         string       `json:"checked_at"`
}

// LeakedConn describes a connection that bypasses VPN
type LeakedConn struct {
	Container  string `json:"container"`
	RemoteIP   string `json:"remote_ip"`
	RemotePort uint16 `json:"remote_port"`
	Domain     string `json:"domain"`
	Country    string `json:"country"`
	ISP        string `json:"isp"`
	Category   string `json:"category"`
}

func (s *Server) handleLeakTest(w http.ResponseWriter, r *http.Request) {
	conns := s.capture.GetConnections()

	// Append host connections
	s.hostMu.RLock()
	for _, hc := range s.hostConns {
		cp := *hc
		conns = append(conns, &cp)
	}
	s.hostMu.RUnlock()

	serverLoc := s.geo.GetServerLocation()
	serverIP := ""
	if serverLoc != nil {
		serverIP = serverLoc.IP
	}

	// Find torrent-related containers
	torrentConns := make([]*capture.Connection, 0)
	for _, c := range conns {
		name := strings.ToLower(c.ContainerName)
		if strings.Contains(name, "qbit") || strings.Contains(name, "torrent") ||
			strings.Contains(name, "deluge") || strings.Contains(name, "transmission") {
			torrentConns = append(torrentConns, c)
		}
	}

	if len(torrentConns) == 0 {
		writeJSON(w, LeakTestResult{
			Status:    "no_torrent",
			ServerIP:  serverIP,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	vpnCount := 0
	directCount := 0
	mullvadExitSet := make(map[string]bool)
	var leaked []LeakedConn

	safeCategories := map[string]bool{
		"mullvad": true,
		"private": true,
		"tailnet": true,
	}

	for _, c := range torrentConns {
		cat := c.Category
		if cat == "" || cat == "resolving" {
			continue
		}

		if safeCategories[cat] {
			vpnCount++
			if cat == "mullvad" {
				mullvadExitSet[c.RemoteIP] = true
			}
			continue
		}

		// Skip DNS traffic (port 53) — expected to be local
		if c.RemotePort == 53 {
			continue
		}

		directCount++
		leaked = append(leaked, LeakedConn{
			Container:  c.ContainerName,
			RemoteIP:   c.RemoteIP,
			RemotePort: c.RemotePort,
			Domain:     c.RemoteDomain,
			Country:    c.Country,
			ISP:        c.ISP,
			Category:   cat,
		})
	}

	mullvadExits := make([]string, 0, len(mullvadExitSet))
	for ip := range mullvadExitSet {
		mullvadExits = append(mullvadExits, ip)
	}

	status := "secure"
	if directCount > 0 {
		status = "leak"
	} else if vpnCount == 0 {
		status = "warning"
	}

	writeJSON(w, LeakTestResult{
		Status:            status,
		ServerIP:          serverIP,
		MullvadExits:      mullvadExits,
		LeakedConnections: leaked,
		VPNConnCount:      vpnCount,
		DirectConnCount:   directCount,
		CheckedAt:         time.Now().UTC().Format(time.RFC3339),
	})
}

func validateRule(r *rules.Rule) error {
	if r.Action != "allow" && r.Action != "block" {
		return fmt.Errorf("action must be 'allow' or 'block'")
	}
	if r.Direction != "outbound" && r.Direction != "inbound" && r.Direction != "both" {
		return fmt.Errorf("direction must be 'outbound', 'inbound', or 'both'")
	}
	if r.Protocol != "tcp" && r.Protocol != "udp" && r.Protocol != "*" {
		return fmt.Errorf("protocol must be 'tcp', 'udp', or '*'")
	}
	if r.ContainerName == "" {
		r.ContainerName = "*"
	}
	if r.RemoteHost == "" {
		r.RemoteHost = "*"
	}
	if r.Protocol == "" {
		r.Protocol = "*"
	}
	return nil
}
