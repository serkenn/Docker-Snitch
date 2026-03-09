package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/serken/docker-snitch/internal/api"
	"github.com/serken/docker-snitch/internal/capture"
	"github.com/serken/docker-snitch/internal/conntrack"
	"github.com/serken/docker-snitch/internal/containers"
	"github.com/serken/docker-snitch/internal/db"
	"github.com/serken/docker-snitch/internal/qbit"
	"github.com/serken/docker-snitch/internal/rules"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Docker Snitch starting...")

	// Config from environment
	dbPath := getEnv("SNITCH_DB_PATH", "/data/snitch.db")
	apiPort := getEnvInt("SNITCH_API_PORT", 9645)
	queueNum := getEnvInt("SNITCH_QUEUE_NUM", 0)
	defaultAction := getEnv("SNITCH_DEFAULT_ACTION", "allow")

	// Context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle shutdown signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Open database
	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer database.Close()

	// Rule store and engine
	ruleStore := rules.NewStore(database)
	ruleEngine := rules.NewEngine(ruleStore, defaultAction)

	// Container resolver
	resolver, err := containers.NewResolver()
	if err != nil {
		log.Fatalf("container resolver: %v", err)
	}
	defer resolver.Close()

	if err := resolver.Start(ctx); err != nil {
		log.Fatalf("container resolver start: %v", err)
	}

	// DNS cache
	dnsCache := conntrack.NewDNSCache()

	// GeoIP resolver
	geoResolver := conntrack.NewGeoResolver()

	// WebSocket hub
	hub := api.NewWSHub()

	// Event handler - broadcasts events to WebSocket clients
	eventHandler := func(conn *capture.Connection, eventType string) {
		hub.Broadcast(api.Event{
			Type: eventType,
			Data: conn,
		})
	}

	// Packet capture
	nfq := capture.NewNFQueueCapture(uint16(queueNum), resolver, ruleEngine, dnsCache, geoResolver, eventHandler)

	// Setup iptables
	if err := nfq.SetupIPTables(); err != nil {
		log.Fatalf("iptables setup: %v", err)
	}

	// Start capture
	if err := nfq.Start(ctx); err != nil {
		nfq.CleanupIPTables()
		log.Fatalf("capture start: %v", err)
	}

	// qBittorrent client (optional)
	qbitURL := getEnv("SNITCH_QBIT_URL", "")
	qbitUser := getEnv("SNITCH_QBIT_USER", "admin")
	qbitPass := getEnv("SNITCH_QBIT_PASS", "")
	var qbitClient *qbit.Client
	if qbitURL != "" {
		qbitClient = qbit.NewClient(qbitURL, qbitUser, qbitPass, geoResolver)
		log.Printf("qbit: configured at %s", qbitURL)
	}

	// API server
	server := api.NewServer(apiPort, nfq, resolver, ruleStore, ruleEngine, hub, qbitClient, geoResolver)
	go func() {
		if err := server.Start(); err != nil {
			log.Printf("api server: %v", err)
			cancel()
		}
	}()

	log.Printf("Docker Snitch ready - API on port %d", apiPort)

	// Wait for shutdown
	<-sigCh
	log.Println("shutting down...")
	cancel()
	nfq.Stop()
	nfq.CleanupIPTables()
	log.Println("goodbye")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
