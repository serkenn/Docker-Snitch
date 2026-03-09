package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// HostConnection represents a tracked host-level connection
type HostConnection struct {
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

var monitorURL string

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("snitch-host-agent starting...")

	monitorURL = getEnv("SNITCH_MONITOR_URL", "http://127.0.0.1:9645")
	interval := getEnvInt("SNITCH_POLL_INTERVAL", 2)

	// Build process lookup table from /proc/net/tcp + /proc/*/fd
	log.Printf("monitor URL: %s, poll interval: %ds", monitorURL, interval)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	prev := make(map[string]*HostConnection)

	for {
		select {
		case <-sigCh:
			log.Println("shutting down")
			return
		case <-ticker.C:
			conns, err := readConntrack()
			if err != nil {
				log.Printf("conntrack read: %v", err)
				continue
			}

			// Build process map
			procMap := buildProcMap()

			// Detect changes and enrich with process names
			var events []HostConnection
			current := make(map[string]*HostConnection)

			for _, c := range conns {
				key := connKey(c)
				current[key] = c

				// Look up process name
				localKey := fmt.Sprintf("%s:%d", c.SrcIP, c.SrcPort)
				if proc, ok := procMap[localKey]; ok {
					c.Process = proc
				}

				old, existed := prev[key]
				if !existed {
					// New connection
					events = append(events, *c)
				} else if c.BytesSent != old.BytesSent || c.BytesRecv != old.BytesRecv || c.State != old.State {
					// Updated connection
					events = append(events, *c)
				}
			}

			prev = current

			if len(events) > 0 {
				sendEvents(events)
			}
		}
	}
}

var conntrackRe = regexp.MustCompile(
	`(tcp|udp)\s+\d+\s+\d+\s+(\S+)?\s*` +
		`src=(\S+)\s+dst=(\S+)\s+sport=(\d+)\s+dport=(\d+)\s+` +
		`(?:packets=\d+\s+)?bytes=(\d+)\s+` +
		`src=\S+\s+dst=\S+\s+sport=\d+\s+dport=\d+\s+` +
		`(?:packets=\d+\s+)?bytes=(\d+)`,
)

func readConntrack() ([]*HostConnection, error) {
	data, err := os.ReadFile("/proc/net/nf_conntrack")
	if err != nil {
		return nil, err
	}

	var conns []*HostConnection
	for _, line := range strings.Split(string(data), "\n") {
		m := conntrackRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}

		sport, _ := strconv.ParseUint(m[5], 10, 16)
		dport, _ := strconv.ParseUint(m[6], 10, 16)
		bytesSent, _ := strconv.ParseUint(m[7], 10, 64)
		bytesRecv, _ := strconv.ParseUint(m[8], 10, 64)

		state := strings.TrimSpace(m[2])
		if state == "" {
			state = "ACTIVE"
		}

		conns = append(conns, &HostConnection{
			Protocol:  m[1],
			SrcIP:     m[3],
			DstIP:     m[4],
			SrcPort:   uint16(sport),
			DstPort:   uint16(dport),
			BytesSent: bytesSent,
			BytesRecv: bytesRecv,
			State:     state,
		})
	}
	return conns, nil
}

// buildProcMap maps "ip:port" -> process name by reading /proc/net/tcp and /proc/*/fd
func buildProcMap() map[string]string {
	result := make(map[string]string)

	// Read /proc/net/tcp and /proc/net/udp to get inode->address mapping
	inodeToAddr := make(map[string]string)
	for _, proto := range []string{"tcp", "udp", "tcp6", "udp6"} {
		parseProc("/proc/net/"+proto, inodeToAddr)
	}

	// Scan /proc/*/fd to map inode->pid, then pid->process name
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return result
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid := entry.Name()
		if pid[0] < '0' || pid[0] > '9' {
			continue
		}

		fdDir := filepath.Join("/proc", pid, "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}

		var procName string
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			if !strings.HasPrefix(link, "socket:[") {
				continue
			}
			inode := link[8 : len(link)-1]

			if addr, ok := inodeToAddr[inode]; ok {
				if procName == "" {
					comm, err := os.ReadFile(filepath.Join("/proc", pid, "comm"))
					if err != nil {
						continue
					}
					procName = strings.TrimSpace(string(comm))
				}
				result[addr] = procName
			}
		}
	}

	return result
}

func parseProc(path string, inodeToAddr map[string]string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		if i == 0 {
			continue // header
		}
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}

		// Parse local address (fields[1] is hex ip:port)
		localAddr := fields[1]
		inode := fields[9]

		ip, port := parseHexAddr(localAddr)
		if ip == "" {
			continue
		}

		key := fmt.Sprintf("%s:%d", ip, port)
		inodeToAddr[inode] = key
	}
}

func parseHexAddr(hexAddr string) (string, uint16) {
	parts := strings.Split(hexAddr, ":")
	if len(parts) != 2 {
		return "", 0
	}

	hexIP := parts[0]
	hexPort := parts[1]

	port, _ := strconv.ParseUint(hexPort, 16, 16)

	if len(hexIP) == 8 {
		// IPv4
		b0, _ := strconv.ParseUint(hexIP[6:8], 16, 8)
		b1, _ := strconv.ParseUint(hexIP[4:6], 16, 8)
		b2, _ := strconv.ParseUint(hexIP[2:4], 16, 8)
		b3, _ := strconv.ParseUint(hexIP[0:2], 16, 8)
		return fmt.Sprintf("%d.%d.%d.%d", b0, b1, b2, b3), uint16(port)
	}

	// IPv6 - skip for now
	return "", 0
}

func connKey(c *HostConnection) string {
	return fmt.Sprintf("%s|%s:%d->%s:%d", c.Protocol, c.SrcIP, c.SrcPort, c.DstIP, c.DstPort)
}

func sendEvents(events []HostConnection) {
	data, err := json.Marshal(events)
	if err != nil {
		return
	}

	resp, err := http.Post(monitorURL+"/api/host-events", "application/json", bytes.NewReader(data))
	if err != nil {
		log.Printf("send: %v", err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != 200 {
		log.Printf("send: status %d", resp.StatusCode)
	}
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
