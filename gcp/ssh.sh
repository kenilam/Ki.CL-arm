#!/usr/bin/env bash
# A shell on the machine over IAP; it has no public address. Extra arguments
# are run there instead: `gcp/ssh.sh nvidia-smi`.
source "$(dirname "$0")/env.sh"

if [ $# -gt 0 ]; then
  exec gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --command "$*"
fi

exec gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap
