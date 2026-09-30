#!/usr/bin/env bash
# localhost:LOCAL_PORT here becomes PORT on the machine, over IAP. The local
# side is 3300 because 3200 here is this repo's own dev server, which still
# serves the federated remote; Ki.CL's dev server sends /arm/link to
# KICL_ARM_BRIDGE_URL, so with the tunnel up the page's arms are on the
# GCP machine and everything else about the page is unchanged.
source "$(dirname "$0")/env.sh"

LOCAL_PORT="${LOCAL_PORT:-3300}"

echo "localhost:$LOCAL_PORT -> $NAME:$PORT (ctrl-c to close)"
echo "in Ki.CL: KICL_ARM_BRIDGE_URL=http://localhost:$LOCAL_PORT"
exec gcloud compute start-iap-tunnel "$NAME" "$PORT" \
  --zone "$ZONE" \
  --project "$PROJECT" \
  --local-host-port "localhost:$LOCAL_PORT"
