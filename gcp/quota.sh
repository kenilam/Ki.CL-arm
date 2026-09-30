#!/usr/bin/env bash
# What the project may run: L4s in the region, and GPUs anywhere. Both start
# at zero on a new project and the request can take a day, so this runs first.
source "$(dirname "$0")/env.sh"

quota() {
  tr ';' '\n' | grep -A2 "metric': '$1'" | grep -oE "(limit|usage)': [0-9.]+" | tr '\n' ' '
}

printf "project        %s\n" "$PROJECT"
printf "region         %s\n" "$REGION"
printf "NVIDIA_L4_GPUS %s\n" "$(gcloud compute regions describe "$REGION" --project "$PROJECT" --format="value(quotas)" | quota NVIDIA_L4_GPUS)"
printf "GPUS_ALL_REGIONS %s\n" "$(gcloud compute project-info describe --project "$PROJECT" --format="value(quotas)" | quota GPUS_ALL_REGIONS)"
echo
echo "A limit of 0 means asking for 1 of each at:"
echo "https://console.cloud.google.com/iam-admin/quotas?project=$PROJECT&pageState=(%22allQuotasTable%22:(%22f%22:%22%255B%257B_22k_22_3A_22_22_2C_22t_22_3A10_2C_22v_22_3A_22_5C_22L4_5C_22_22%257D%255D%22))"
