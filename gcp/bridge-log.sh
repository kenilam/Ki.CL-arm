#!/usr/bin/env bash
# The last lines the STAGE's bridge logged on the machine.
source "$(dirname "$0")/env.sh"

exec gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command "sudo docker logs --tail 40 $BRIDGE" 2>/dev/null
