#!/bin/bash
set -euo pipefail

# =============================================================================
# Docker Snitch - Server Setup Script
# Run on a fresh Ubuntu server to set up everything automatically.
# Usage: sudo bash scripts/serversetup.sh
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/docker-snitch"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}===${NC} $1 ${BLUE}===${NC}"; }

# Check root
if [ "$(id -u)" -ne 0 ]; then
  err "Run this script as root: sudo bash $0"
fi

# Check OS
if ! grep -qi 'ubuntu\|debian' /etc/os-release 2>/dev/null; then
  warn "This script is designed for Ubuntu/Debian. Proceeding anyway..."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "1/7 Installing system dependencies"
# ─────────────────────────────────────────────────────────────────────────────

apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release \
  conntrack iptables \
  > /dev/null 2>&1
log "System dependencies installed"

# ─────────────────────────────────────────────────────────────────────────────
step "2/7 Installing Docker"
# ─────────────────────────────────────────────────────────────────────────────

if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin > /dev/null 2>&1
  systemctl enable --now docker
  log "Docker installed"
fi

# Detect compose command
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
  DC="docker compose"
fi
log "Compose command: $DC"

# ─────────────────────────────────────────────────────────────────────────────
step "3/7 Enabling conntrack kernel module"
# ─────────────────────────────────────────────────────────────────────────────

modprobe nf_conntrack 2>/dev/null || true
modprobe nf_conntrack_ipv4 2>/dev/null || true

# Enable accounting (needed for byte counts in /proc/net/nf_conntrack)
echo 1 > /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null || true

# Persist across reboots
if ! grep -q nf_conntrack /etc/modules-load.d/*.conf 2>/dev/null; then
  echo "nf_conntrack" > /etc/modules-load.d/conntrack.conf
fi

# Persist accounting
if ! grep -q nf_conntrack_acct /etc/sysctl.d/*.conf 2>/dev/null; then
  echo "net.netfilter.nf_conntrack_acct=1" > /etc/sysctl.d/99-conntrack.conf
  sysctl -p /etc/sysctl.d/99-conntrack.conf > /dev/null 2>&1
fi

if [ -f /proc/net/nf_conntrack ]; then
  log "conntrack active ($(wc -l < /proc/net/nf_conntrack) tracked connections)"
else
  warn "conntrack file not found - host monitoring may not work"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "4/7 Copying project files"
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
cp -r "$PROJECT_DIR/monitor" "$INSTALL_DIR/"
cp -r "$PROJECT_DIR/frontend" "$INSTALL_DIR/"
cp "$PROJECT_DIR/docker-compose.yml" "$INSTALL_DIR/"

if [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$INSTALL_DIR/.env"
  log "Copied .env"
elif [ -f "$PROJECT_DIR/.env.example" ]; then
  cp "$PROJECT_DIR/.env.example" "$INSTALL_DIR/.env"
  warn "Created .env from .env.example - edit $INSTALL_DIR/.env to configure"
fi
log "Project files copied to $INSTALL_DIR"

# ─────────────────────────────────────────────────────────────────────────────
step "5/7 Building host agent"
# ─────────────────────────────────────────────────────────────────────────────

cd "$INSTALL_DIR"
log "Building snitch-host-agent via Docker..."
docker build -f monitor/Dockerfile.agent -t snitch-agent-builder monitor/

# Extract binary from image
CONTAINER_ID=$(docker create snitch-agent-builder)
docker cp "$CONTAINER_ID:/snitch-host-agent" /usr/local/bin/snitch-host-agent
docker rm "$CONTAINER_ID" > /dev/null
chmod +x /usr/local/bin/snitch-host-agent
log "Host agent binary installed at /usr/local/bin/snitch-host-agent"

# ─────────────────────────────────────────────────────────────────────────────
step "6/7 Installing host agent systemd service"
# ─────────────────────────────────────────────────────────────────────────────

cp "$PROJECT_DIR/scripts/snitch-host-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable snitch-host-agent
log "Host agent service installed"

# ─────────────────────────────────────────────────────────────────────────────
step "7/7 Starting services"
# ─────────────────────────────────────────────────────────────────────────────

cd "$INSTALL_DIR"

log "Building Docker containers..."
$DC build

log "Starting Docker Snitch..."
$DC down 2>/dev/null || true
$DC up -d

# Wait for monitor to be ready
echo -n "  Waiting for monitor API..."
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:9645/api/stats > /dev/null 2>&1; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 1
done

# Start host agent (needs monitor to be up)
systemctl restart snitch-host-agent
log "Host agent started"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Docker Snitch setup complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "  Web UI:        http://$(hostname -I | awk '{print $1}'):9080"
echo "  Monitor API:   http://127.0.0.1:9645"
echo "  Install dir:   $INSTALL_DIR"
echo "  Host agent:    systemctl status snitch-host-agent"
echo ""
echo "  Commands:"
echo "    cd $INSTALL_DIR && $DC logs -f    # view logs"
echo "    systemctl status snitch-host-agent # host agent status"
echo "    systemctl restart snitch-host-agent"
echo ""

# Show container status
$DC ps

# Quick check
HOST_CONNS=$(wc -l < /proc/net/nf_conntrack 2>/dev/null || echo "?")
echo ""
echo "  Host connections tracked: $HOST_CONNS"
echo ""

if [ -f "$INSTALL_DIR/.env" ] && ! grep -q 'SNITCH_QBIT_URL=http' "$INSTALL_DIR/.env"; then
  warn "qBittorrent not configured. Edit $INSTALL_DIR/.env and set SNITCH_QBIT_URL"
fi
