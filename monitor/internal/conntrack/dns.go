package conntrack

import (
	"encoding/binary"
	"net"
	"sync"
	"time"
)

// DNSEntry holds a DNS cache entry
type DNSEntry struct {
	Domain  string
	Expires time.Time
}

// DNSCache provides passive DNS resolution
type DNSCache struct {
	cache map[string]*DNSEntry
	mu    sync.RWMutex
}

// NewDNSCache creates a new DNS cache
func NewDNSCache() *DNSCache {
	d := &DNSCache{
		cache: make(map[string]*DNSEntry),
	}
	go d.cleanupLoop()
	return d
}

// Lookup returns the domain name for an IP, or empty string
func (d *DNSCache) Lookup(ip string) string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if entry, ok := d.cache[ip]; ok {
		if time.Now().Before(entry.Expires) {
			return entry.Domain
		}
	}
	return ""
}

// RecordDNS parses a DNS response payload and caches A/AAAA records
func (d *DNSCache) RecordDNS(data []byte) {
	if len(data) < 12 {
		return
	}

	// DNS header
	flags := binary.BigEndian.Uint16(data[2:4])
	isResponse := flags&0x8000 != 0
	if !isResponse {
		return
	}

	qdcount := binary.BigEndian.Uint16(data[4:6])
	ancount := binary.BigEndian.Uint16(data[6:8])

	if ancount == 0 {
		return
	}

	offset := 12

	// Skip questions
	for i := 0; i < int(qdcount); i++ {
		name, newOffset := parseDNSName(data, offset)
		_ = name
		if newOffset < 0 {
			return
		}
		offset = newOffset + 4 // skip QTYPE and QCLASS
		if offset > len(data) {
			return
		}
	}

	// Parse answers
	for i := 0; i < int(ancount); i++ {
		name, newOffset := parseDNSName(data, offset)
		if newOffset < 0 || newOffset+10 > len(data) {
			return
		}
		offset = newOffset

		rtype := binary.BigEndian.Uint16(data[offset : offset+2])
		_ = binary.BigEndian.Uint16(data[offset+2 : offset+4]) // class
		ttl := binary.BigEndian.Uint32(data[offset+4 : offset+8])
		rdlength := binary.BigEndian.Uint16(data[offset+8 : offset+10])
		offset += 10

		if offset+int(rdlength) > len(data) {
			return
		}

		rdata := data[offset : offset+int(rdlength)]
		offset += int(rdlength)

		if ttl < 60 {
			ttl = 60
		}
		if ttl > 3600 {
			ttl = 3600
		}

		switch rtype {
		case 1: // A record
			if len(rdata) == 4 {
				ip := net.IP(rdata).String()
				d.mu.Lock()
				d.cache[ip] = &DNSEntry{
					Domain:  name,
					Expires: time.Now().Add(time.Duration(ttl) * time.Second),
				}
				d.mu.Unlock()
			}
		case 28: // AAAA record
			if len(rdata) == 16 {
				ip := net.IP(rdata).String()
				d.mu.Lock()
				d.cache[ip] = &DNSEntry{
					Domain:  name,
					Expires: time.Now().Add(time.Duration(ttl) * time.Second),
				}
				d.mu.Unlock()
			}
		}
	}
}

func parseDNSName(data []byte, offset int) (string, int) {
	name := ""
	jumped := false
	jumpOffset := -1
	maxJumps := 10

	for i := 0; i < maxJumps; i++ {
		if offset >= len(data) {
			return "", -1
		}

		length := int(data[offset])

		if length == 0 {
			if !jumped {
				jumpOffset = offset + 1
			}
			break
		}

		// Pointer
		if length&0xC0 == 0xC0 {
			if offset+1 >= len(data) {
				return "", -1
			}
			if !jumped {
				jumpOffset = offset + 2
			}
			offset = int(binary.BigEndian.Uint16(data[offset:offset+2]) & 0x3FFF)
			jumped = true
			continue
		}

		offset++
		if offset+length > len(data) {
			return "", -1
		}

		if name != "" {
			name += "."
		}
		name += string(data[offset : offset+length])
		offset += length
	}

	if jumpOffset < 0 {
		jumpOffset = offset
	}
	return name, jumpOffset
}

func (d *DNSCache) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		d.mu.Lock()
		now := time.Now()
		for ip, entry := range d.cache {
			if now.After(entry.Expires) {
				delete(d.cache, ip)
			}
		}
		d.mu.Unlock()
	}
}
