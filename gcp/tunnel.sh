#!/usr/bin/env bash
# localhost:PORT here becomes PORT on the machine, over IAP. With it up,
# Ki.CL's dev server needs no change: its /arm proxy already points at
# localhost:3200, so the page's arms are on the GCP machine.
source "$(dirname "$0")/env.sh"

echo "localhost:$PORT -> $NAME:$PORT (ctrl-c to close)"
exec gcloud compute start-iap-tunnel "$NAME" "$PORT" \
  --zone "$ZONE" \
  --project "$PROJECT" \
  --local-host-port "localhost:$PORT"
