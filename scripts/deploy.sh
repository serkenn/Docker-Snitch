#!/bin/bash
set -euo pipefail

# Deploy Docker Snitch to GCP VM (torrent-pier)
VM_NAME="torrent-pier"
VM_ZONE="europe-west4-a"
REMOTE_DIR="/opt/docker-snitch"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Docker Snitch Deploy ==="
echo "Source: $PROJECT_DIR"
echo "Target: $VM_NAME:$REMOTE_DIR"
echo ""

# Sync project files to VM
echo "[1/3] Syncing files to VM..."
gcloud compute scp --recurse --zone="$VM_ZONE" \
  "$PROJECT_DIR/monitor" \
  "$PROJECT_DIR/frontend" \
  "$PROJECT_DIR/docker-compose.yml" \
  "$VM_NAME:/tmp/docker-snitch-staging/"

# Deploy on VM
echo "[2/3] Setting up on VM..."
gcloud compute ssh "$VM_NAME" --zone="$VM_ZONE" --command="
  sudo mkdir -p $REMOTE_DIR
  sudo cp -r /tmp/docker-snitch-staging/* $REMOTE_DIR/
  rm -rf /tmp/docker-snitch-staging
  cd $REMOTE_DIR

  # Check Docker
  if ! command -v docker &>/dev/null; then
    echo 'ERROR: Docker not installed'
    exit 1
  fi

  # Detect compose command
  if docker compose version &>/dev/null; then
    DC='docker compose'
  elif command -v docker-compose &>/dev/null; then
    DC='docker-compose'
  else
    echo 'ERROR: Neither docker compose nor docker-compose found'
    echo 'Installing docker compose plugin...'
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
    DC='docker compose'
  fi

  # Build and start
  echo \"Using: \$DC\"
  echo 'Building containers...'
  sudo \$DC build --no-cache

  echo 'Starting services...'
  sudo \$DC down 2>/dev/null || true
  sudo \$DC up -d

  echo ''
  echo 'Container status:'
  sudo \$DC ps
"

echo ""
echo "[3/3] Deploy complete!"
echo ""
echo "Access the UI at: http://<VM_EXTERNAL_IP>:8080"
echo "  or via SSH tunnel: gcloud compute ssh $VM_NAME --zone=$VM_ZONE -- -L 8080:localhost:8080"
echo ""
