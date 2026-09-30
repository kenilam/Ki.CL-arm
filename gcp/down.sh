#!/usr/bin/env bash
# Stops the machine, which stops the GPU bill; the disk stays. `--delete`
# takes the machine and its disk away, and the firewall rule and schedule
# with it.
source "$(dirname "$0")/env.sh"

if [ "${1:-}" = "--delete" ]; then
  gcloud compute instances delete "$NAME" --zone "$ZONE" --project "$PROJECT" --quiet
  gcloud compute resource-policies delete "$TAG-stop" --region "$REGION" --project "$PROJECT" --quiet || true
  gcloud compute firewall-rules delete "$TAG-iap" --project "$PROJECT" --quiet || true
  exit 0
fi

gcloud compute instances stop "$NAME" --zone "$ZONE" --project "$PROJECT" >/dev/null
echo "$NAME stopped"
