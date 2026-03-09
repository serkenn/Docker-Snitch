package conntrack

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// GeoInfo holds geographic and ISP information for an IP
type GeoInfo struct {
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
	City        string  `json:"city"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	AS          string  `json:"as"`
	Category    string  `json:"category"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
}

// GeoResolver resolves IP addresses to geographic information
type GeoResolver struct {
	cache   map[string]*GeoInfo
	mu      sync.RWMutex
	limiter chan struct{}
}

// NewGeoResolver creates a new GeoIP resolver
func NewGeoResolver() *GeoResolver {
	return &GeoResolver{
		cache:   make(map[string]*GeoInfo),
		limiter: make(chan struct{}, 2),
	}
}

// Lookup returns geo info for an IP, using cache when available
func (g *GeoResolver) Lookup(ip string) *GeoInfo {
	g.mu.RLock()
	if info, ok := g.cache[ip]; ok {
		g.mu.RUnlock()
		return info
	}
	g.mu.RUnlock()

	info := g.classifyByRange(ip)
	if info != nil {
		g.mu.Lock()
		g.cache[ip] = info
		g.mu.Unlock()
		return info
	}

	go g.fetchAndCache(ip)

	return &GeoInfo{Category: "resolving"}
}

// GetCachedInfo returns cached info without triggering a lookup
func (g *GeoResolver) GetCachedInfo(ip string) *GeoInfo {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if info, ok := g.cache[ip]; ok {
		return info
	}
	return nil
}

func (g *GeoResolver) classifyByRange(ipStr string) *GeoInfo {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return nil
	}

	if isInCIDR(ip, "100.64.0.0/10") {
		return &GeoInfo{
			Category: "tailnet", Org: "Tailscale", ISP: "Tailscale",
			Country: "Tailnet", CountryCode: "TS",
		}
	}

	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return &GeoInfo{
			Category: "private", Org: "Private Network", ISP: "Local",
			Country: "Local", CountryCode: "LO",
		}
	}

	mullvadRanges := []string{
		"185.213.154.0/24", "185.65.135.0/24", "198.54.133.0/24",
		"146.70.0.0/16", "193.27.12.0/24", "141.98.252.0/23",
	}
	for _, cidr := range mullvadRanges {
		if isInCIDR(ip, cidr) {
			return &GeoInfo{
				Category: "mullvad", Org: "Mullvad VPN", ISP: "Mullvad VPN",
				Country: "VPN", CountryCode: "VPN",
			}
		}
	}

	gcpRanges := []string{
		"34.0.0.0/8", "35.184.0.0/13", "35.192.0.0/12",
		"35.208.0.0/12", "35.224.0.0/12", "35.240.0.0/13",
		"104.196.0.0/14", "104.154.0.0/15",
	}
	for _, cidr := range gcpRanges {
		if isInCIDR(ip, cidr) {
			return &GeoInfo{
				Category: "gcp", Org: "Google Cloud Platform", ISP: "Google",
				Country: "Cloud", CountryCode: "GCP",
			}
		}
	}

	return nil
}

type ipAPIResponse struct {
	Status      string  `json:"status"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	City        string  `json:"city"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	AS          string  `json:"as"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
}

func (g *GeoResolver) fetchAndCache(ip string) {
	select {
	case g.limiter <- struct{}{}:
		defer func() { <-g.limiter }()
	default:
		return
	}

	g.mu.RLock()
	if _, ok := g.cache[ip]; ok {
		g.mu.RUnlock()
		return
	}
	g.mu.RUnlock()

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,city,isp,org,as,lat,lon", ip))
	if err != nil {
		log.Printf("geoip: lookup failed for %s: %v", ip, err)
		return
	}
	defer resp.Body.Close()

	var result ipAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return
	}

	if result.Status != "success" {
		return
	}

	info := &GeoInfo{
		Country:     result.Country,
		CountryCode: result.CountryCode,
		City:        result.City,
		ISP:         result.ISP,
		Org:         result.Org,
		AS:          result.AS,
		Category:    classifyByOrg(result.ISP, result.Org, result.AS),
		Lat:         result.Lat,
		Lon:         result.Lon,
	}

	g.mu.Lock()
	g.cache[ip] = info
	g.mu.Unlock()
}

func classifyByOrg(isp, org, as string) string {
	lower := strings.ToLower(isp + " " + org + " " + as)

	switch {
	case strings.Contains(lower, "mullvad"):
		return "mullvad"
	case strings.Contains(lower, "tailscale"):
		return "tailnet"
	case strings.Contains(lower, "google cloud"), strings.Contains(lower, "google llc"):
		return "gcp"
	case strings.Contains(lower, "cloudflare"):
		return "cloudflare"
	case strings.Contains(lower, "amazon"), strings.Contains(lower, "aws"):
		return "aws"
	case strings.Contains(lower, "microsoft"), strings.Contains(lower, "azure"):
		return "azure"
	case strings.Contains(lower, "digitalocean"):
		return "digitalocean"
	case strings.Contains(lower, "hetzner"):
		return "hetzner"
	case strings.Contains(lower, "ovh"):
		return "ovh"
	default:
		return "internet"
	}
}

func isInCIDR(ip net.IP, cidr string) bool {
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		return false
	}
	return network.Contains(ip)
}
