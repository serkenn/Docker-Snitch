package qbit

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/serken/docker-snitch/internal/conntrack"
)

// Peer represents a torrent peer with geo info
type Peer struct {
	IP          string  `json:"ip"`
	Port        int     `json:"port"`
	Client      string  `json:"client"`
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
	City        string  `json:"city"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	ASN         string  `json:"asn"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	DlSpeed     int64   `json:"dl_speed"`
	UpSpeed     int64   `json:"up_speed"`
	Downloaded  int64   `json:"downloaded"`
	Uploaded    int64   `json:"uploaded"`
	Progress    float64 `json:"progress"`
	Flags       string  `json:"flags"`
	Connection  string  `json:"connection"`
	TorrentName string  `json:"torrent_name"`
	TorrentHash string  `json:"torrent_hash"`
}

// TorrentInfo holds basic torrent information
type TorrentInfo struct {
	Hash        string `json:"hash"`
	Name        string `json:"name"`
	State       string `json:"state"`
	Size        int64  `json:"size"`
	DlSpeed     int64  `json:"dlspeed"`
	UpSpeed     int64  `json:"upspeed"`
	NumPeers    int    `json:"num_leechs"`
	NumSeeds    int    `json:"num_seeds"`
	Progress    float64 `json:"progress"`
	Downloaded  int64  `json:"downloaded"`
	Uploaded    int64  `json:"uploaded"`
}

// Client talks to the qBittorrent Web API
type Client struct {
	baseURL     string
	username    string
	password    string
	httpClient  *http.Client
	geoResolver *conntrack.GeoResolver
	mu          sync.Mutex
	loggedIn    bool
}

// NewClient creates a new qBittorrent API client
func NewClient(baseURL, username, password string, geo *conntrack.GeoResolver) *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{
		baseURL:     strings.TrimRight(baseURL, "/"),
		username:    username,
		password:    password,
		geoResolver: geo,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Jar:     jar,
		},
	}
}

// IsConfigured returns true if qBittorrent URL is set
func (c *Client) IsConfigured() bool {
	return c.baseURL != ""
}

func (c *Client) login() error {
	data := url.Values{
		"username": {c.username},
		"password": {c.password},
	}

	resp, err := c.httpClient.PostForm(c.baseURL+"/api/v2/auth/login", data)
	if err != nil {
		return fmt.Errorf("qbit login: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 || strings.TrimSpace(string(body)) != "Ok." {
		return fmt.Errorf("qbit login failed: %s (status %d)", string(body), resp.StatusCode)
	}

	c.loggedIn = true
	log.Printf("qbit: logged in to %s", c.baseURL)
	return nil
}

func (c *Client) doGet(path string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.loggedIn {
		if err := c.login(); err != nil {
			return nil, err
		}
	}

	resp, err := c.httpClient.Get(c.baseURL + path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Session expired, re-login
	if resp.StatusCode == 403 {
		c.loggedIn = false
		if err := c.login(); err != nil {
			return nil, err
		}
		resp, err = c.httpClient.Get(c.baseURL + path)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
	}

	return io.ReadAll(resp.Body)
}

// GetTorrents returns the list of torrents
func (c *Client) GetTorrents() ([]TorrentInfo, error) {
	data, err := c.doGet("/api/v2/torrents/info")
	if err != nil {
		return nil, err
	}

	var torrents []TorrentInfo
	if err := json.Unmarshal(data, &torrents); err != nil {
		return nil, fmt.Errorf("qbit parse torrents: %w", err)
	}
	return torrents, nil
}

// GetAllPeers returns peers for all active torrents, enriched with GeoIP
func (c *Client) GetAllPeers() ([]Peer, error) {
	torrents, err := c.GetTorrents()
	if err != nil {
		return nil, err
	}

	var allPeers []Peer

	for _, t := range torrents {
		// Only query active torrents
		if t.DlSpeed == 0 && t.UpSpeed == 0 && t.State != "downloading" && t.State != "uploading" && t.State != "stalledDL" && t.State != "stalledUP" {
			continue
		}

		data, err := c.doGet(fmt.Sprintf("/api/v2/sync/torrentPeers?hash=%s", t.Hash))
		if err != nil {
			log.Printf("qbit: failed to get peers for %s: %v", t.Hash[:8], err)
			continue
		}

		var result struct {
			Peers map[string]json.RawMessage `json:"peers"`
		}
		if err := json.Unmarshal(data, &result); err != nil {
			continue
		}

		for _, peerData := range result.Peers {
			var raw struct {
				IP         string  `json:"ip"`
				Port       int     `json:"port"`
				Client     string  `json:"client"`
				Country    string  `json:"country"`
				CountryCode string `json:"country_code"`
				DlSpeed    int64   `json:"dl_speed"`
				UpSpeed    int64   `json:"up_speed"`
				Downloaded int64   `json:"downloaded"`
				Uploaded   int64   `json:"uploaded"`
				Progress   float64 `json:"progress"`
				Flags      string  `json:"flags"`
				Connection string  `json:"connection"`
			}
			if err := json.Unmarshal(peerData, &raw); err != nil {
				continue
			}

			// Skip peers with no activity
			if raw.Downloaded == 0 && raw.Uploaded == 0 && raw.DlSpeed == 0 && raw.UpSpeed == 0 {
				continue
			}

			peer := Peer{
				IP:          raw.IP,
				Port:        raw.Port,
				Client:      raw.Client,
				Country:     raw.Country,
				CountryCode: raw.CountryCode,
				DlSpeed:     raw.DlSpeed,
				UpSpeed:     raw.UpSpeed,
				Downloaded:  raw.Downloaded,
				Uploaded:    raw.Uploaded,
				Progress:    raw.Progress,
				Flags:       raw.Flags,
				Connection:  raw.Connection,
				TorrentName: t.Name,
				TorrentHash: t.Hash,
			}

			// Enrich with GeoIP
			if geo := c.geoResolver.Lookup(raw.IP); geo != nil && geo.Category != "resolving" {
				peer.City = geo.City
				peer.ISP = geo.ISP
				peer.Org = geo.Org
				peer.ASN = geo.AS
				peer.Lat = geo.Lat
				peer.Lon = geo.Lon
				if peer.Country == "" {
					peer.Country = geo.Country
				}
				if peer.CountryCode == "" {
					peer.CountryCode = geo.CountryCode
				}
			}

			allPeers = append(allPeers, peer)
		}
	}

	return allPeers, nil
}
