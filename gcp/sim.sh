#!/usr/bin/env bash
# Puts sim/ on the machine and starts our cell in Isaac Sim there: the arm from
# sim/arm.urdf, once per id in ARMS, each on its own ROS 2 topics. The bridge
# in ROS mode drives them. `make gcp.isaac.log` tails the simulator's log.
source "$(dirname "$0")/env.sh"

ARMS="${ARMS:-arm-a}"
tar="$(mktemp -t arm-sim).tgz"

tar -czf "$tar" -C "$here/.." sim
gcloud compute scp "$tar" "$NAME:/tmp/arm-sim.tgz" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet 2>/dev/null
rm -f "$tar"
gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command \
  "sudo mkdir -p /var/lib/arm && sudo tar -xzf /tmp/arm-sim.tgz -C /var/lib/arm && ls /var/lib/arm/sim" 2>/dev/null

# CAMERA=1 puts a camera over each cell on ROS 2, at the cost of the physics' real-time rate.
exec "$here/isaac.sh" "cd /isaac-sim && PYTHONUNBUFFERED=1 ./python.sh /arm/sim/scene.py --arms $ARMS ${CAMERA:+--camera} $*"
