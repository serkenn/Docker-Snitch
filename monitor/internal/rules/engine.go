package rules

import (
	"log"
	"net"
	"sort"
	"sync"
)

// Engine evaluates packets against rules
type Engine struct {
	store         *Store
	rules         []Rule
	defaultAction string
	mu            sync.RWMutex
}

// NewEngine creates a new rule engine
func NewEngine(store *Store, defaultAction string) *Engine {
	e := &Engine{
		store:         store,
		defaultAction: defaultAction,
	}
	e.Reload()
	return e
}

// Reload refreshes the in-memory rule cache from the database
func (e *Engine) Reload() {
	rules, err := e.store.List()
	if err != nil {
		log.Printf("rules reload error: %v", err)
		return
	}

	// Sort by priority (lower number = higher priority)
	sort.Slice(rules, func(i, j int) bool {
		return rules[i].Priority < rules[j].Priority
	})

	e.mu.Lock()
	e.rules = rules
	e.mu.Unlock()

	log.Printf("rules: loaded %d rules", len(rules))
}

// Check evaluates a connection against rules and returns "allow" or "block"
func (e *Engine) Check(containerName, remoteIP string, remotePort uint16, protocol, direction string) string {
	e.mu.RLock()
	defer e.mu.RUnlock()

	for _, rule := range e.rules {
		if !rule.Enabled {
			continue
		}
		if !e.matchContainer(rule.ContainerName, containerName) {
			continue
		}
		if !e.matchDirection(rule.Direction, direction) {
			continue
		}
		if !e.matchHost(rule.RemoteHost, remoteIP) {
			continue
		}
		if !e.matchPort(rule.RemotePort, remotePort) {
			continue
		}
		if !e.matchProtocol(rule.Protocol, protocol) {
			continue
		}
		return rule.Action
	}

	return e.defaultAction
}

func (e *Engine) matchContainer(pattern, name string) bool {
	return pattern == "*" || pattern == name
}

func (e *Engine) matchDirection(pattern, dir string) bool {
	return pattern == "both" || pattern == dir
}

func (e *Engine) matchHost(pattern, ip string) bool {
	if pattern == "*" {
		return true
	}
	// Check CIDR
	if _, cidr, err := net.ParseCIDR(pattern); err == nil {
		if parsed := net.ParseIP(ip); parsed != nil {
			return cidr.Contains(parsed)
		}
	}
	// Exact match
	return pattern == ip
}

func (e *Engine) matchPort(rulePort int, actualPort uint16) bool {
	return rulePort == 0 || rulePort == int(actualPort)
}

func (e *Engine) matchProtocol(pattern, proto string) bool {
	return pattern == "*" || pattern == proto
}
