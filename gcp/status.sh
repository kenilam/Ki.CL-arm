#!/usr/bin/env bash
# Where the machine is at, and the tail of what its startup script said.
source "$(dirname "$0")/env.sh"

gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$PROJECT" \
  --format='table[no-heading](name,status,machineType.basename(),scheduling.provisioningModel,networkInterfaces[0].networkIP)' \
  || exit 1
echo
gcloud compute instances get-serial-port-output "$NAME" --zone "$ZONE" --project "$PROJECT" 2>/dev/null \
  | grep "arm-startup:" | tail -n 5
