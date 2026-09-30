#!/usr/bin/env bash
# Builds the bridge on the machine and runs it there as container BRIDGE on
# PORT (`arm` on 3200 for prod, `arm-dev` on 3201 with STAGE=dev), restarting
# with the machine. The sources travel over IAP as a tarball; the machine has
# Docker and the Rust image builds them, so nothing else is installed there.
source "$(dirname "$0")/env.sh"

STORE=/var/lib/arm/bridge-$STAGE
# ROS=1 builds the ROS 2 flavour and runs it on the host's network with Fast DDS over UDP, so it finds the
# arms in Isaac Sim; the plain flavour has the simulated controller behind every id and needs neither.
ROS="${ROS:-0}"
MIDDLEWARE=/etc/isaac-ros-cli/docker/middleware_profiles
if [ "$ROS" = 1 ]; then
  dockerfile=bridge/Dockerfile.ros2
  run="--network host -e ROS_DOMAIN_ID=0 -e FASTRTPS_DEFAULT_PROFILES_FILE=/arm/middleware/rtps_udp_profile.xml -v $MIDDLEWARE:/arm/middleware:ro"
  args="--listen 0.0.0.0:$PORT --ros"
else
  dockerfile=bridge/Dockerfile
  run="-p $PORT:3200"
  args="--listen 0.0.0.0:3200"
fi
tar="$(mktemp -t arm-bridge).tgz"

tar -czf "$tar" -C "$here/.." --exclude 'bridge/target' proto bridge
echo "sources: $(du -h "$tar" | cut -f1)"

gcloud compute scp "$tar" "$NAME:/tmp/arm-bridge.tgz" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet 2>/dev/null
rm -f "$tar"

gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command "
  set -e
  sudo mkdir -p $STORE && sudo rm -rf $STORE/src && sudo mkdir -p $STORE/src
  sudo tar -xzf /tmp/arm-bridge.tgz -C $STORE/src
  sudo docker build -q -f $STORE/src/$dockerfile -t arm-bridge:$STAGE $STORE/src
  sudo docker rm -f $BRIDGE >/dev/null 2>&1 || true
  sudo docker run -d --name $BRIDGE --restart unless-stopped $run arm-bridge:$STAGE $args >/dev/null
  sleep 2
  sudo docker ps --filter name=^$BRIDGE\$ --format '{{.Names}} {{.Status}} {{.Ports}}'
  sudo docker logs $BRIDGE 2>&1 | tail -n 3
" 2>/dev/null
