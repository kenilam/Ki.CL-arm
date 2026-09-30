#!/usr/bin/env bash
# What the project may run: L4s in the region, and GPUs anywhere. Both start
# at zero on a new project and the request can take a day, so this runs first.
source "$(dirname "$0")/env.sh"

# One quota per line once the list is split; the one for the metric holds its own limit and usage.
quota() {
  tr ';' '\n' | grep "metric': '$1'" | grep -oE "(limit|usage)': [0-9.]+" | sed -E "s/': / /" | tr '\n' ' '
}

printf "project        %s\n" "$PROJECT"
printf "region         %s\n" "$REGION"
printf "NVIDIA_L4_GPUS %s\n" "$(gcloud compute regions describe "$REGION" --project "$PROJECT" --format="value(quotas)" | quota NVIDIA_L4_GPUS)"
printf "GPUS_ALL_REGIONS %s\n" "$(gcloud compute project-info describe --project "$PROJECT" --format="value(quotas)" | quota GPUS_ALL_REGIONS)"
echo
echo "A limit of 0 means asking for 1 of it (GPUS_ALL_REGIONS is the usual one) at:"
echo "https://console.cloud.google.com/iam-admin/quotas?project=$PROJECT  (filter: GPUS_ALL_REGIONS)"
