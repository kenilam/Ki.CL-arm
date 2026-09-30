#!/usr/bin/env bash
# The one place the machine is described. Every value can be overridden from
# the environment: `ZONE=europe-west4-b make gcp.up`.

set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-us-central1-a}"
REGION="${REGION:-${ZONE%-*}}"
NAME="${NAME:-arm}"
# A G2 machine comes with its L4 built in; no accelerator flag needed.
MACHINE="${MACHINE:-g2-standard-8}"
# Isaac Sim's container alone is tens of gigabytes.
DISK_GB="${DISK_GB:-200}"
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu-2204-lts}"
IMAGE_PROJECT="${IMAGE_PROJECT:-ubuntu-os-cloud}"
# SPOT=1 for a preemptible machine at a fraction of the price; fine for a dev box, not for a demo.
SPOT="${SPOT:-0}"
# The bridge, and for now the dev arm server, listen here. The IAP tunnel lands on it.
PORT="${PORT:-3200}"
# The machine stops itself every night at this hour, so a forgotten box costs one evening, not a month.
STOP_AT="${STOP_AT:-22}"
TIMEZONE="${TIMEZONE:-America/Los_Angeles}"
TAG="arm"
IAP_RANGE="35.235.240.0/20"

if [ -z "$PROJECT" ]; then
  echo "no project: gcloud config set project <id>, or PROJECT=<id>" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
