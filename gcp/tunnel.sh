#!/usr/bin/env bash
# localhost:LOCAL_PORT here becomes PORT on the machine, over IAP. The local
# side is 3300 because 3200 is the local bridge, which Ki.CL's KICL_ARM_URL
# points at for the remote and the link. Ki.CL never dials the machine itself:
# from step 4 the bridge relays robots switched to physical AI to it.
source "$(dirname "$0")/env.sh"

LOCAL_PORT="${LOCAL_PORT:-3300}"

# A tunnel left running from last time holds the port; this one takes its place.
"$here/../scripts/free-port.sh" "$LOCAL_PORT"

echo "localhost:$LOCAL_PORT -> $NAME:$PORT ($BRIDGE, ctrl-c to close)"
# The bridge's port is closed for a minute while its container rebuilds, and the machine end of a tunnel
# goes with it: rather than fail, wait and dial again, so a tunnel left running comes back on its own.
while :; do
  gcloud compute start-iap-tunnel "$NAME" "$PORT" \
    --zone "$ZONE" \
    --project "$PROJECT" \
    --local-host-port "localhost:$LOCAL_PORT" && break

  echo "no bridge on $NAME:$PORT yet; again in 5s (ctrl-c to stop)"
  sleep 5
done
