package rules

import "time"

// Rule defines a network access rule
type Rule struct {
	ID            int64     `json:"id"`
	ContainerName string    `json:"container_name"` // "*" for all
	Direction     string    `json:"direction"`       // "outbound", "inbound", "both"
	RemoteHost    string    `json:"remote_host"`     // IP, CIDR, or "*"
	RemotePort    int       `json:"remote_port"`     // 0 = any
	Protocol      string    `json:"protocol"`        // "tcp", "udp", "*"
	Action        string    `json:"action"`          // "allow", "block"
	Priority      int       `json:"priority"`        // lower = higher priority
	Enabled       bool      `json:"enabled"`
	Note          string    `json:"note,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
