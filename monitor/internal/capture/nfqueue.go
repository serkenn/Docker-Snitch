package capture

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"os/exec"
	"sync"
	"time"

	"github.com/serken/docker-snitch/internal/conntrack"

	nfqueue "github.com/florianl/go-nfqueue/v2"
)

// EventHandler is called when a new connection event occurs
type EventHandler func(conn *Connection, eventType string)

// RuleChecker checks if a packet should be allowed or blocked
type RuleChecker interface {
	Check(containerName, remoteIP string, remotePort uint16, protocol, direction string) string
}

// ContainerResolver maps IPs to container names
type ContainerResolver interface {
	Resolve(ip string) (name string, found bool)
	IsContainerIP(ip string) bool
}

// DNSResolver maps IPs to domain names
type DNSResolver interface {
	Lookup(ip string) string
	RecordDNS(data []byte)
}

// NFQueueCapture captures packets using NFQUEUE
type NFQueueCapture struct {
	queueNum     uint16
	nf           *nfqueue.Nfqueue
	resolver     ContainerResolver
	ruleChecker  RuleChecker
	dnsResolver  DNSResolver
	geoResolver  *conntrack.GeoResolver
	handler      EventHandler
	connections  map[string]*Connection
	flowIndex    map[FlowKey]string // flow -> connection ID
	mu           sync.RWMutex
	connCounter  uint64
}

// NewNFQueueCapture creates a new NFQUEUE-based capture engine
func NewNFQueueCapture(queueNum uint16, resolver ContainerResolver, ruleChecker RuleChecker, dnsResolver DNSResolver, geoResolver *conntrack.GeoResolver, handler EventHandler) *NFQueueCapture {
	return &NFQueueCapture{
		queueNum:    queueNum,
		resolver:    resolver,
		ruleChecker: ruleChecker,
		dnsResolver: dnsResolver,
		geoResolver: geoResolver,
		handler:     handler,
		connections: make(map[string]*Connection),
		flowIndex:   make(map[FlowKey]string),
	}
}

// SetupIPTables adds the NFQUEUE rule to the DOCKER-USER chain
func (c *NFQueueCapture) SetupIPTables() error {
	exec.Command("iptables", "-N", "DOCKER-USER").Run()

	cmd := exec.Command("iptables", "-I", "DOCKER-USER", "-j", "NFQUEUE",
		"--queue-num", fmt.Sprintf("%d", c.queueNum),
		"--queue-bypass")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("iptables setup failed: %s: %w", string(out), err)
	}
	log.Printf("iptables: added NFQUEUE rule on DOCKER-USER chain (queue %d)", c.queueNum)
	return nil
}

// CleanupIPTables removes the NFQUEUE rule
func (c *NFQueueCapture) CleanupIPTables() {
	cmd := exec.Command("iptables", "-D", "DOCKER-USER", "-j", "NFQUEUE",
		"--queue-num", fmt.Sprintf("%d", c.queueNum),
		"--queue-bypass")
	if err := cmd.Run(); err != nil {
		log.Printf("iptables cleanup warning: %v", err)
	} else {
		log.Println("iptables: removed NFQUEUE rule")
	}
}

// Start begins capturing packets
func (c *NFQueueCapture) Start(ctx context.Context) error {
	config := nfqueue.Config{
		NfQueue:      c.queueNum,
		MaxPacketLen: 65535,
		MaxQueueLen:  1024,
		Copymode:     nfqueue.NfQnlCopyPacket,
	}

	nf, err := nfqueue.Open(&config)
	if err != nil {
		return fmt.Errorf("nfqueue open: %w", err)
	}
	c.nf = nf

	fn := func(a nfqueue.Attribute) int {
		c.handlePacket(a)
		return 0
	}

	if err := nf.RegisterWithErrorFunc(ctx, fn, func(e error) int {
		if ctx.Err() != nil {
			return 1
		}
		log.Printf("nfqueue error: %v", e)
		return 0
	}); err != nil {
		nf.Close()
		return fmt.Errorf("nfqueue register: %w", err)
	}

	log.Printf("nfqueue: listening on queue %d", c.queueNum)

	go c.cleanupLoop(ctx)
	go c.geoEnrichLoop(ctx)

	return nil
}

// Stop closes the NFQUEUE handle
func (c *NFQueueCapture) Stop() {
	if c.nf != nil {
		c.nf.Close()
	}
}

// GetConnections returns a snapshot of active connections
func (c *NFQueueCapture) GetConnections() []*Connection {
	c.mu.RLock()
	defer c.mu.RUnlock()

	conns := make([]*Connection, 0, len(c.connections))
	for _, conn := range c.connections {
		cp := *conn
		// Enrich with latest geo info
		if cp.Category == "" || cp.Category == "resolving" {
			if geo := c.geoResolver.GetCachedInfo(cp.RemoteIP); geo != nil {
				cp.Country = geo.Country
				cp.CountryCode = geo.CountryCode
				cp.City = geo.City
				cp.ISP = geo.ISP
				cp.Org = geo.Org
				cp.ASN = geo.AS
				cp.Category = geo.Category
			}
		}
		conns = append(conns, &cp)
	}
	return conns
}

func (c *NFQueueCapture) handlePacket(attr nfqueue.Attribute) {
	if attr.Payload == nil || len(*attr.Payload) < 20 {
		if attr.PacketID != nil {
			c.nf.SetVerdict(*attr.PacketID, nfqueue.NfAccept)
		}
		return
	}

	payload := *attr.Payload
	pkt := c.parseIPPacket(payload)
	if pkt == nil {
		if attr.PacketID != nil {
			c.nf.SetVerdict(*attr.PacketID, nfqueue.NfAccept)
		}
		return
	}

	// Handle DNS responses for passive DNS
	if pkt.IsDNS && pkt.DNSData != nil {
		c.dnsResolver.RecordDNS(pkt.DNSData)
	}

	// Determine direction and container
	containerName := ""
	containerIP := ""
	remoteIP := ""
	direction := "outbound"

	srcIP := pkt.SrcIP.String()
	dstIP := pkt.DstIP.String()

	if name, found := c.resolver.Resolve(srcIP); found {
		containerName = name
		containerIP = srcIP
		remoteIP = dstIP
		direction = "outbound"
	} else if name, found := c.resolver.Resolve(dstIP); found {
		containerName = name
		containerIP = dstIP
		remoteIP = srcIP
		direction = "inbound"
	} else {
		if attr.PacketID != nil {
			c.nf.SetVerdict(*attr.PacketID, nfqueue.NfAccept)
		}
		return
	}

	remotePort := pkt.DstPort
	localPort := pkt.SrcPort
	if direction == "inbound" {
		remotePort = pkt.SrcPort
		localPort = pkt.DstPort
	}

	action := c.ruleChecker.Check(containerName, remoteIP, remotePort, pkt.Protocol, direction)

	if attr.PacketID != nil {
		if action == "block" {
			c.nf.SetVerdict(*attr.PacketID, nfqueue.NfDrop)
		} else {
			c.nf.SetVerdict(*attr.PacketID, nfqueue.NfAccept)
		}
	}

	flow := FlowKey{
		SrcIP:    containerIP,
		DstIP:    remoteIP,
		SrcPort:  localPort,
		DstPort:  remotePort,
		Protocol: pkt.Protocol,
	}

	c.mu.Lock()

	connID, exists := c.flowIndex[flow]
	if !exists {
		connID, exists = c.flowIndex[flow.ReverseKey()]
	}

	if exists {
		if conn, ok := c.connections[connID]; ok {
			conn.LastSeen = time.Now()
			if direction == "outbound" {
				conn.BytesSent += uint64(pkt.Length)
			} else {
				conn.BytesRecv += uint64(pkt.Length)
			}
			connCopy := *conn
			c.mu.Unlock()
			c.handler(&connCopy, "connection_update")
			return
		}
	}

	// New connection
	c.connCounter++
	connID = fmt.Sprintf("conn-%d-%d", time.Now().UnixMilli(), c.connCounter)

	domain := c.dnsResolver.Lookup(remoteIP)

	// Get geo info (may be async, returns "resolving" category initially)
	geo := c.geoResolver.Lookup(remoteIP)

	conn := &Connection{
		ID:            connID,
		ContainerName: containerName,
		ContainerIP:   containerIP,
		RemoteIP:      remoteIP,
		RemoteDomain:  domain,
		RemotePort:    remotePort,
		LocalPort:     localPort,
		Protocol:      pkt.Protocol,
		Direction:     direction,
		Action:        action,
		StartTime:     time.Now(),
		LastSeen:      time.Now(),
		Active:        true,
	}

	if geo != nil {
		conn.Country = geo.Country
		conn.CountryCode = geo.CountryCode
		conn.City = geo.City
		conn.ISP = geo.ISP
		conn.Org = geo.Org
		conn.ASN = geo.AS
		conn.Category = geo.Category
	}

	if direction == "outbound" {
		conn.BytesSent = uint64(pkt.Length)
	} else {
		conn.BytesRecv = uint64(pkt.Length)
	}

	c.connections[connID] = conn
	c.flowIndex[flow] = connID

	connCopy := *conn
	c.mu.Unlock()

	c.handler(&connCopy, "connection_new")
}

func (c *NFQueueCapture) parseIPPacket(data []byte) *PacketInfo {
	if len(data) < 20 {
		return nil
	}

	version := data[0] >> 4
	if version != 4 {
		return nil
	}

	headerLen := int(data[0]&0x0F) * 4
	if len(data) < headerLen {
		return nil
	}

	totalLen := binary.BigEndian.Uint16(data[2:4])
	protocol := data[9]

	pkt := &PacketInfo{
		SrcIP:  net.IP(data[12:16]),
		DstIP:  net.IP(data[16:20]),
		Length: uint32(totalLen),
	}

	transportData := data[headerLen:]

	switch protocol {
	case 6: // TCP
		if len(transportData) < 4 {
			return nil
		}
		pkt.Protocol = "tcp"
		pkt.SrcPort = binary.BigEndian.Uint16(transportData[0:2])
		pkt.DstPort = binary.BigEndian.Uint16(transportData[2:4])

	case 17: // UDP
		if len(transportData) < 4 {
			return nil
		}
		pkt.Protocol = "udp"
		pkt.SrcPort = binary.BigEndian.Uint16(transportData[0:2])
		pkt.DstPort = binary.BigEndian.Uint16(transportData[2:4])

		if pkt.SrcPort == 53 && len(transportData) > 8 {
			pkt.IsDNS = true
			pkt.DNSData = transportData[8:]
		}

	case 1: // ICMP
		pkt.Protocol = "icmp"

	default:
		return nil
	}

	return pkt
}

func (c *NFQueueCapture) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			now := time.Now()
			for id, conn := range c.connections {
				if now.Sub(conn.LastSeen) > 2*time.Minute {
					conn.Active = false
					connCopy := *conn
					delete(c.connections, id)
					for k, v := range c.flowIndex {
						if v == id {
							delete(c.flowIndex, k)
						}
					}
					go c.handler(&connCopy, "connection_closed")
				}
			}
			c.mu.Unlock()
		}
	}
}

// geoEnrichLoop periodically enriches connections with resolved geo data
func (c *NFQueueCapture) geoEnrichLoop(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			for _, conn := range c.connections {
				if conn.Category == "" || conn.Category == "resolving" {
					if geo := c.geoResolver.GetCachedInfo(conn.RemoteIP); geo != nil {
						conn.Country = geo.Country
						conn.CountryCode = geo.CountryCode
						conn.City = geo.City
						conn.ISP = geo.ISP
						conn.Org = geo.Org
						conn.ASN = geo.AS
						conn.Category = geo.Category
					}
				}
			}
			c.mu.Unlock()
		}
	}
}
