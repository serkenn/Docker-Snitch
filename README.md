# Docker Snitch

Little Snitch inspired network monitor for Docker containers **and the host system**. Captures, visualizes, and controls all network traffic via a web GUI.

## Features

- **Real-time connection monitoring** -- see every TCP/UDP connection from containers and host processes
- **Host-level monitoring** -- systemd agent captures all Ubuntu system traffic via conntrack with process identification (`[sshd]`, `[tailscaled]`, etc.)
- **World Map** -- OpenStreetMap / Leaflet multi-hop topology visualization (Peers → Mullvad → GCP → Tailnet → NAS)
- **Torrent peer tracking** -- qBittorrent API integration shows individual peer IPs, countries, ISPs, DL/UL speeds, and transfer amounts
- **GeoIP resolution** -- automatic country, city, ISP, ASN, and lat/lon lookup via ip-api.com, including server's own public IP
- **Traffic categorization** -- auto-classifies connections as Tailnet, GCP, Mullvad VPN, Cloudflare, AWS, Azure, Hetzner, OVH, or Internet
- **Per-container filtering** -- click or Cmd/Ctrl+Click to multi-select containers and view combined traffic
- **Network Map** -- Mermaid topology diagram grouped by traffic category with bandwidth breakdowns
- **Firewall rules** -- allow/block rules per container, remote host, port, and protocol
- **Passive DNS** -- resolves IPs to domain names by sniffing DNS responses
- **Traffic charts** -- per-container bandwidth visualization with Recharts
- **WebSocket live updates** -- dashboard updates in real-time as packets flow
- **One-command server setup** -- `serversetup.sh` installs everything on a fresh Ubuntu server

## Architecture

```
                                         ┌──────────────────┐
                                         │  ip-api.com      │
                                         │  (GeoIP)         │
                                         └────────┬─────────┘
                                                  │
┌──────────────────┐   ┌──────────────────────────┴──────────────────────┐
│  Host Agent      │──>│  Monitor Container (Go)                         │
│  (systemd)       │   │  ┌──────────┐ ┌────────────┐ ┌───────────────┐ │
│  conntrack +     │   │  │ REST API │ │  NFQUEUE   │ │ qBittorrent   │ │
│  process lookup  │   │  │ + WS Hub │ │  Capture   │ │ API Client    │ │
└──────────────────┘   │  └──────────┘ └────────────┘ └───────────────┘ │
                       │  ┌──────────┐ ┌────────────┐ ┌───────────────┐ │
┌──────────────────┐   │  │  Rules   │ │ Container  │ │ GeoIP + Auto  │ │
│  Frontend        │──>│  │  Engine  │ │ Resolver   │ │ Server Locate │ │
│  React/Vite      │   │  └──────────┘ └────────────┘ └───────────────┘ │
│  Leaflet + OSM   │   │  ┌──────────┐ ┌────────────┐                   │
│  port 9080       │   │  │  SQLite  │ │ Passive DNS│                   │
└──────────────────┘   │  └──────────┘ └────────────┘                   │
                       └──────────────────────┬──────────────────────────┘
                                              │
                              ┌────────────────┼────────────────┐
                    iptables DOCKER-USER   /proc/net/nf_conntrack
                              │                                 │
                    ┌─────────┴───────────┐    ┌────────────────┴──┐
                    │  Docker Containers   │    │  Host Processes    │
                    │  qbittorrent,gluetun │    │  sshd, tailscaled  │
                    │  nginx, etc.         │    │  apt, systemd      │
                    └─────────────────────┘    └───────────────────┘
```

### How it works

**Container monitoring (NFQUEUE):**

1. The monitor container runs with `network_mode: host` and `NET_ADMIN` capability
2. It inserts an iptables rule into the `DOCKER-USER` chain with `--queue-bypass`
3. Every packet traversing the Docker bridge is delivered to the Go program via NFQUEUE
4. The program identifies the container via Docker API, checks rules, and issues ACCEPT or DROP
5. Connection events are broadcast via WebSocket

**Host monitoring (conntrack agent):**

1. A lightweight Go binary runs as a systemd service on the host
2. It polls `/proc/net/nf_conntrack` every 2 seconds for all tracked connections
3. It identifies the owning process by mapping `/proc/net/tcp` inodes to `/proc/[pid]/fd`
4. Connection data (with process names and byte counts) is POSTed to the monitor's `/api/host-events`
5. The monitor enriches with GeoIP and broadcasts alongside container connections

**Torrent peer tracking (qBittorrent API):**

1. The monitor optionally connects to qBittorrent's Web API
2. Fetches peer lists for all active torrents
3. GeoIP resolves each peer's IP for lat/lon
4. Frontend displays peers on the World Map connected through the Mullvad VPN exit

## Quick Start

### Automated server setup (Ubuntu)

```bash
git clone https://github.com/serkenn/Docker-Snitch.git
cd Docker-Snitch
sudo bash scripts/serversetup.sh
```

This installs Docker, builds everything, and starts all services including the host agent.

### Manual setup

```bash
# Copy .env.example and configure
cp .env.example .env
# Edit .env to set qBittorrent URL/credentials (optional)

docker compose up --build
```

Open **http://localhost:9080** in your browser.

### Test with sample containers

```bash
docker run -d --name nginx-test nginx
docker run -d --name curl-test curlimages/curl sleep 3600
docker exec curl-test curl -s https://example.com
docker exec curl-test curl -s https://api.github.com
```

## Web GUI

### Connections Tab

All active connections from containers and host processes in real-time:

| Column | Description |
|--------|-------------|
| Container | Container name or `[process]` for host traffic |
| Dir | Outbound (↑) or Inbound (↓) |
| Remote | Domain name or IP address |
| Port | Remote port number |
| Proto | TCP / UDP |
| Location | Country flag, city, and country |
| ISP / Org | Internet service provider or organization |
| Type | Category badge (Tailnet, GCP, Mullvad, AWS, Cloudflare, etc.) |
| Action | Allow (green) or Block (red) |
| Sent/Recv | Bytes transferred |
| Duration | Connection lifetime |

Click **Block** on any connection to create a block rule.

### World Map Tab

Multi-hop network topology on OpenStreetMap (CARTO Dark Matter tiles):

- **GCP Server** marker at auto-detected location (via public IP GeoIP)
- **Mullvad VPN Exit** nodes as intermediate hops (green)
- **Torrent Peers** connected through Mullvad with per-peer DL/UL stats (yellow)
- **Tailnet** endpoints (purple)
- **Direct Internet** connections to the server
- Curved arc lines sized by traffic volume
- Peer table showing IP, country, city, ISP, client, DL/UL speed, progress, torrent name
- Stats bar with total peers, DL/UL speed, Mullvad exit count

### Network Map Tab

Mermaid topology diagram:
- Category-grouped subgraphs with bandwidth breakdown cards
- Traffic volume on each edge
- Blocked connections in red

### Rules Tab

| Field | Values |
|-------|--------|
| Container | Container name or `*` (all) |
| Direction | outbound / inbound / both |
| Remote Host | IP, CIDR (e.g., `10.0.0.0/8`), or `*` |
| Remote Port | Port number or `0` (any) |
| Protocol | tcp / udp / `*` |
| Action | allow / block |
| Priority | Lower number = higher priority |

Rules are evaluated in priority order. First match wins. Default action is **allow**.

## Configuration

### Monitor container (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `SNITCH_DB_PATH` | `/data/snitch.db` | SQLite database path |
| `SNITCH_API_PORT` | `9645` | API server port |
| `SNITCH_DEFAULT_ACTION` | `allow` | Default verdict when no rule matches |
| `SNITCH_QUEUE_NUM` | `0` | NFQUEUE queue number |
| `SNITCH_QBIT_URL` | (empty) | qBittorrent Web API URL (e.g., `http://localhost:8080`) |
| `SNITCH_QBIT_USER` | `admin` | qBittorrent username |
| `SNITCH_QBIT_PASS` | (empty) | qBittorrent password |

### Host agent (environment variables in systemd unit)

| Variable | Default | Description |
|----------|---------|-------------|
| `SNITCH_MONITOR_URL` | `http://127.0.0.1:9645` | Monitor API URL |
| `SNITCH_POLL_INTERVAL` | `2` | Conntrack poll interval in seconds |

## Project Structure

```
├── docker-compose.yml
├── .env.example                    # qBittorrent configuration template
├── scripts/
│   ├── serversetup.sh              # One-command Ubuntu server setup
│   ├── deploy.sh                   # GCP VM deploy script
│   └── snitch-host-agent.service   # systemd unit for host agent
├── monitor/                        # Go backend
│   ├── Dockerfile                  # Monitor container image
│   ├── Dockerfile.agent            # Host agent binary builder
│   ├── cmd/
│   │   ├── monitor/main.go         # Monitor entrypoint
│   │   └── hostagent/main.go       # Host agent entrypoint
│   └── internal/
│       ├── capture/                # NFQUEUE packet capture
│       ├── containers/             # Docker API container resolver
│       ├── conntrack/              # DNS cache + GeoIP resolver + server location
│       ├── qbit/                   # qBittorrent API client
│       ├── rules/                  # Rule engine + SQLite store
│       ├── api/                    # REST API + WebSocket hub + host events
│       └── db/                     # Database init + migrations
└── frontend/                       # React web GUI
    ├── Dockerfile
    └── src/
        ├── components/
        │   ├── ConnectionTable     # Live connections table
        │   ├── ContainerList       # Multi-select container sidebar
        │   ├── WorldMap            # Multi-hop topology map + peer table
        │   ├── NetworkMap          # Mermaid topology diagram
        │   ├── TrafficChart        # Bandwidth chart
        │   ├── RuleList            # Rules management
        │   └── RuleEditor          # Rule create/edit modal
        ├── api/                    # REST + WebSocket client
        └── types/                  # TypeScript interfaces
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/connections` | All active connections (containers + host) |
| GET | `/api/containers` | Docker containers list |
| GET | `/api/stats` | Summary statistics |
| GET | `/api/peers` | Torrent peers (requires qBittorrent) |
| GET | `/api/torrents` | Torrent list (requires qBittorrent) |
| GET | `/api/server-location` | Server's public IP and geo info |
| POST | `/api/host-events` | Receive host agent connection data |
| GET | `/api/rules` | List firewall rules |
| POST | `/api/rules` | Create rule |
| PUT | `/api/rules/:id` | Update rule |
| DELETE | `/api/rules/:id` | Delete rule |
| GET | `/api/ws` | WebSocket for real-time events |

## Limitations

- IPv4 only (IPv6 support planned)
- Host agent requires Linux with conntrack kernel module
- On macOS with Docker Desktop, `network_mode: host` means the Linux VM's host
- NFQUEUE has throughput limits; not suitable for 10Gbps+ traffic
- ip-api.com free tier is rate-limited to 45 requests/minute

## License

MIT
