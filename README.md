# Docker Snitch

Little Snitch inspired network monitor for Docker containers. Captures, visualizes, and controls all network traffic from your Docker containers via a web GUI.

## Features

- **Real-time connection monitoring** -- see every TCP/UDP connection from every container
- **Per-container filtering** -- click a single container or Cmd/Ctrl+Click to multi-select and view combined traffic
- **Network Map** -- Mermaid-based topology diagram showing all containers, their connections, and traffic flow
- **Firewall rules** -- create allow/block rules per container, remote host, port, and protocol
- **Passive DNS** -- automatically resolves IPs to domain names by sniffing DNS responses
- **Traffic charts** -- per-container bandwidth visualization with Recharts
- **WebSocket live updates** -- dashboard updates in real-time as packets flow

## Architecture

```
┌────────────┐     ┌─────────────────────────────────────┐
│  Frontend   │────>│  Monitor (Go)                       │
│  React/Vite │ WS  │  ┌─────────┐  ┌──────────────────┐ │
│  port 8080  │────>│  │ REST API │  │ NFQUEUE Capture  │ │
└────────────┘     │  └─────────┘  └──────────────────┘ │
                    │  ┌─────────┐  ┌──────────────────┐ │
                    │  │ Rules   │  │ Container Resolve │ │
                    │  │ Engine  │  │ (Docker API)      │ │
                    │  └─────────┘  └──────────────────┘ │
                    │  ┌─────────┐  ┌──────────────────┐ │
                    │  │ SQLite  │  │ Passive DNS      │ │
                    │  └─────────┘  └──────────────────┘ │
                    └─────────────────────────────────────┘
                              │
                    iptables DOCKER-USER chain
                              │
                    ┌─────────────────────┐
                    │  Docker Bridge Net   │
                    │  ┌───┐ ┌───┐ ┌───┐  │
                    │  │ A │ │ B │ │ C │  │
                    │  └───┘ └───┘ └───┘  │
                    └─────────────────────┘
```

### How it works

1. The monitor container runs with `network_mode: host` and `NET_ADMIN` capability
2. It inserts an iptables rule into the `DOCKER-USER` chain: `iptables -I DOCKER-USER -j NFQUEUE --queue-num 0 --queue-bypass`
3. Every packet traversing the Docker bridge is delivered to the Go program via NFQUEUE (netlink)
4. The program parses each packet, identifies the source/destination container via Docker API, checks rules, and issues ACCEPT or DROP
5. Connection events are broadcast to the web dashboard via WebSocket
6. On shutdown, the iptables rule is automatically cleaned up. `--queue-bypass` ensures traffic flows even if the monitor crashes

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Docker Desktop running (or Docker daemon on Linux)

### Run

```bash
docker compose up --build
```

Open **http://localhost:8080** in your browser.

### Test with sample containers

```bash
# Start some containers to generate traffic
docker run -d --name nginx-test nginx
docker run -d --name redis-test redis
docker run -d --name curl-test curlimages/curl sleep 3600

# Generate traffic
docker exec curl-test curl -s https://example.com
docker exec curl-test curl -s https://api.github.com
```

## Web GUI

### Connections Tab

Shows all active connections in real-time:

| Column | Description |
|--------|-------------|
| Container | Source/destination container name |
| Dir | Outbound (↑) or Inbound (↓) |
| Remote | Domain name or IP address |
| Port | Remote port number |
| Proto | TCP / UDP |
| Action | Allow (green) or Block (red) |
| Sent/Recv | Bytes transferred |
| Duration | Connection lifetime |

Click **Block** on any connection to create a block rule.

### Container Sidebar

- **Click** a container to filter to only its connections
- **Cmd/Ctrl+Click** to select multiple containers and see combined traffic
- Selection summary shows total connections and bandwidth for selected containers
- Green dot = container has active traffic

### Network Map Tab

Interactive Mermaid diagram showing:
- All Docker containers (blue border)
- Remote endpoints they connect to (gray border, red if blocked)
- Traffic volume on each edge
- Docker bridge network hub
- Respects container selection filter

Expandable "Mermaid Source" section shows the raw diagram code.

### Rules Tab

Create, edit, toggle, and delete firewall rules:

| Field | Values |
|-------|--------|
| Container | Container name or `*` (all) |
| Direction | outbound / inbound / both |
| Remote Host | IP, CIDR (e.g., `10.0.0.0/8`), or `*` |
| Remote Port | Port number or `0` (any) |
| Protocol | tcp / udp / `*` |
| Action | allow / block |
| Priority | Lower number = higher priority |

Rules are evaluated in priority order. First match wins. Default action is **allow** (fail-open).

## Configuration

Environment variables for the monitor container:

| Variable | Default | Description |
|----------|---------|-------------|
| `SNITCH_DB_PATH` | `/data/snitch.db` | SQLite database path |
| `SNITCH_API_PORT` | `9645` | API server port |
| `SNITCH_DEFAULT_ACTION` | `allow` | Default verdict when no rule matches |
| `SNITCH_QUEUE_NUM` | `0` | NFQUEUE queue number |

## Project Structure

```
├── docker-compose.yml
├── monitor/                     # Go backend
│   ├── Dockerfile
│   ├── cmd/monitor/main.go      # Entrypoint
│   └── internal/
│       ├── capture/             # NFQUEUE packet capture
│       ├── containers/          # Docker API container resolver
│       ├── conntrack/           # DNS cache
│       ├── rules/               # Rule engine + SQLite store
│       ├── api/                 # REST API + WebSocket hub
│       └── db/                  # Database init + migrations
└── frontend/                    # React web GUI
    ├── Dockerfile
    └── src/
        ├── components/
        │   ├── ConnectionTable  # Live connections table
        │   ├── ContainerList    # Multi-select container sidebar
        │   ├── NetworkMap       # Mermaid topology diagram
        │   ├── TrafficChart     # Bandwidth chart
        │   ├── RuleList         # Rules management
        │   └── RuleEditor       # Rule create/edit modal
        ├── api/                 # REST + WebSocket client
        └── types/               # TypeScript interfaces
```

## Limitations

- IPv4 only (IPv6 support planned)
- Monitors Docker bridge networks only (not host or macvlan)
- On macOS with Docker Desktop, `network_mode: host` means the Linux VM's host, not the macOS host -- this works correctly for monitoring container traffic
- NFQUEUE has throughput limits; not suitable for 10Gbps+ traffic

## License

MIT
