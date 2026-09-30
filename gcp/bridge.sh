#!/usr/bin/env bash
# Builds the bridge on the machine and runs it there on PORT, restarting with
# the machine. The sources travel over IAP as a tarball; the machine has
# Docker and the Rust image builds them, so nothing else is installed there.
source "$(dirname "$0")/env.sh"

STORE=/var/lib/arm/bridge
tar="$(mktemp -t arm-bridge).tgz"

tar -czf "$tar" -C "$here/.." --exclude 'bridge/target' proto bridge
echo "sources: $(du -h "$tar" | cut -f1)"

gcloud compute scp "$tar" "$NAME:/tmp/arm-bridge.tgz" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet 2>/dev/null
rm -f "$tar"

gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command "
  set -e
  sudo mkdir -p $STORE && sudo rm -rf $STORE/src && sudo mkdir -p $STORE/src
  sudo tar -xzf /tmp/arm-bridge.tgz -C $STORE/src
  sudo docker build -q -f $STORE/src/bridge/Dockerfile -t arm-bridge $STORE/src
  sudo docker rm -f arm-bridge >/dev/null 2>&1 || true
  sudo docker run -d --name arm-bridge --restart unless-stopped -p $PORT:3200 arm-bridge --listen 0.0.0.0:3200 >/dev/null
  sleep 2
  sudo docker ps --filter name=arm-bridge --format '{{.Image}} {{.Status}} {{.Ports}}'
  sudo docker logs arm-bridge 2>&1 | tail -n 3
" 2>/dev/null
