#!/usr/bin/env bash
# Logs the machine's Docker in to NVIDIA's registry, where the Isaac Sim and
# Isaac ROS containers live. The key comes from NGC_API_KEY in this shell and
# travels over the IAP ssh session; it is never written into a script or the
# instance metadata.
source "$(dirname "$0")/env.sh"

if [ -z "${NGC_API_KEY:-}" ]; then
  echo "NGC_API_KEY is not set; make one at https://org.ngc.nvidia.com/setup/api-key" >&2
  exit 1
fi

printf '%s' "$NGC_API_KEY" | gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap \
  --command 'sudo docker login nvcr.io --username "$oauthtoken" --password-stdin'
