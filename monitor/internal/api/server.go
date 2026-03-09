package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/serken/docker-snitch/internal/capture"
	"github.com/serken/docker-snitch/internal/containers"
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
}

// NewServer creates a new API server
func NewServer(port int, cap *capture.NFQueueCapture, resolver *containers.Resolver, ruleStore *rules.Store, engine *rules.Engine, hub *WSHub) *Server {
	return &Server{
		port:      port,
		capture:   cap,
		resolver:  resolver,
		ruleStore: ruleStore,
		engine:    engine,
		hub:       hub,
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

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
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
