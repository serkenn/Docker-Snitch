package capture

import (
	"fmt"
	"net"
	"time"
)

// Connection represents a tracked network connection
type Connection struct {
	ID            string    `json:"id"`
	ContainerName string    `json:"container"`
	ContainerIP   string    `json:"container_ip"`
	RemoteIP      string    `json:"remote_ip"`
	RemoteDomain  string    `json:"remote_domain,omitempty"`
	RemotePort    uint16    `json:"remote_port"`
	LocalPort     uint16    `json:"local_port"`
	Protocol      string    `json:"protocol"`
	Direction     string    `json:"direction"` // "outbound" or "inbound"
	Action        string    `json:"action"`    // "allow" or "block"
	BytesSent     uint64    `json:"bytes_sent"`
	BytesRecv     uint64    `json:"bytes_recv"`
	StartTime     time.Time `json:"start_time"`
	LastSeen      time.Time `json:"last_seen"`
	Active        bool      `json:"active"`
	Country       string    `json:"country,omitempty"`
	CountryCode   string    `json:"country_code,omitempty"`
	City          string    `json:"city,omitempty"`
	ISP           string    `json:"isp,omitempty"`
	Org           string    `json:"org,omitempty"`
	ASN           string    `json:"asn,omitempty"`
	Category      string    `json:"category,omitempty"` // tailnet, gcp, mullvad, private, cloudflare, aws, internet
}

// PacketInfo holds parsed information from a captured packet
type PacketInfo struct {
	SrcIP    net.IP
	DstIP    net.IP
	SrcPort  uint16
	DstPort  uint16
	Protocol string // "tcp", "udp", "icmp"
	Length   uint32
	IsDNS    bool
	DNSData  []byte // raw DNS payload if IsDNS
}

// FlowKey uniquely identifies a connection flow
type FlowKey struct {
	SrcIP    string
	DstIP    string
	SrcPort  uint16
	DstPort  uint16
	Protocol string
}

func (f FlowKey) String() string {
	return fmt.Sprintf("%s:%d->%s:%d/%s", f.SrcIP, f.SrcPort, f.DstIP, f.DstPort, f.Protocol)
}

// ReverseKey returns the reverse direction flow key
func (f FlowKey) ReverseKey() FlowKey {
	return FlowKey{
		SrcIP:    f.DstIP,
		DstIP:    f.SrcIP,
		SrcPort:  f.DstPort,
		DstPort:  f.SrcPort,
		Protocol: f.Protocol,
	}
}
