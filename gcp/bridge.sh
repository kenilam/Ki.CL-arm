#!/usr/bin/env bash
# Builds the bridge on the machine and runs it there as container BRIDGE on
# PORT (`arm` on 3200 for prod, `arm-dev` on 3201 with STAGE=dev), restarting
# with the machine. The sources travel over IAP as a tarball; the machine has
# Docker and the Rust image builds them, so nothing else is installed there.
source "$(dirname "$0")/env.sh"

STORE=/var/lib/arm/bridge-$STAGE
tar="$(mktemp -t arm-bridge).tgz"

tar -czf "$tar" -C "$here/.." --exclude 'bridge/target' proto bridge
echo "sources: $(du -h "$tar" | cut -f1)"

gcloud compute scp "$tar" "$NAME:/tmp/arm-bridge.tgz" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet 2>/dev/null
rm -f "$tar"

gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command "
  set -e
  sudo mkdir -p $STORE && sudo rm -rf $STORE/src && sudo mkdir -p $STORE/src
  sudo tar -xzf /tmp/arm-bridge.tgz -C $STORE/src
  sudo docker build -q -f $STORE/src/bridge/Dockerfile -t arm-bridge:$STAGE $STORE/src
  sudo docker rm -f $BRIDGE >/dev/null 2>&1 || true
  sudo docker run -d --name $BRIDGE --restart unless-stopped -p $PORT:3200 arm-bridge:$STAGE --listen 0.0.0.0:3200 >/dev/null
  sleep 2
  sudo docker ps --filter name=^$BRIDGE\$ --format '{{.Names}} {{.Status}} {{.Ports}}'
  sudo docker logs $BRIDGE 2>&1 | tail -n 3
" 2>/dev/null
