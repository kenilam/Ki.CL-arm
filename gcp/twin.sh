#!/usr/bin/env bash
# Puts the twin on the machine and runs it: sim/ goes to /var/lib/arm/sim
# (the robot from `make assets`, and the twin), then Isaac Sim's container
# runs sim/twin/main.py headless, answering /arm/link on PORT. The bridge
# reaches it through `make gcp.tunnel`. Logs: `make gcp.isaac.log`.
source "$(dirname "$0")/env.sh"

root="$(cd "$here/.." && pwd)"

echo "uploading sim/ to $NAME"
tar czf - -C "$root" --exclude 'sim/out' --exclude '__pycache__' --exclude 'test_*.py' sim |
  gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command \
    "sudo mkdir -p /var/lib/arm && sudo rm -rf /var/lib/arm/sim/twin /var/lib/arm/sim/robot && sudo tar xzf - -C /var/lib/arm && sudo chown -R 1234:1234 /var/lib/arm/sim" \
    2>/dev/null

# protobuf is not in Isaac's Python; websockets is, and the twin uses that one.
"$here/isaac.sh" "cd /isaac-sim && ./python.sh -m pip install --quiet --target /arm/sim/deps protobuf==5.29.3 && PYTHONPATH=/arm/sim/deps:/arm/sim/twin:/arm/sim/twin/wire ./python.sh /arm/sim/twin/main.py --port $PORT"
