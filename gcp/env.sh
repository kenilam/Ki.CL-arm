#!/usr/bin/env bash
# The one place the machine is described. Every value can be overridden from
# the environment: `ZONE=europe-west4-b make gcp.up`.

set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
# c: a and b had no L4 to give when the machine was made (2026-09-29).
ZONE="${ZONE:-us-central1-c}"
REGION="${REGION:-${ZONE%-*}}"
NAME="${NAME:-arm}"
# A G2 machine comes with its L4 built in; no accelerator flag needed.
MACHINE="${MACHINE:-g2-standard-8}"
# Isaac Sim's container is 32 GB and Isaac ROS's another 15 or so; 100 GB holds both with their caches.
DISK_GB="${DISK_GB:-100}"
# 24.04: Isaac ROS 5.0's tooling supports nothing older on x86_64.
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu-2404-lts-amd64}"
IMAGE_PROJECT="${IMAGE_PROJECT:-ubuntu-os-cloud}"
# SPOT=1 for a preemptible machine at a fraction of the price; fine for a dev box, not for a demo.
SPOT="${SPOT:-0}"
# The bridge, and for now the dev arm server, listen here. The IAP tunnel lands on it.
PORT="${PORT:-3200}"
# The machine stops itself every night at this hour, so a forgotten box costs one evening, not a month.
STOP_AT="${STOP_AT:-22}"
TIMEZONE="${TIMEZONE:-America/Los_Angeles}"
# The Secret Manager secret holding the NGC API key; the machine reads it itself to log Docker in to nvcr.io.
NGC_SECRET="${NGC_SECRET:-ngc-api-key}"
TAG="arm"
IAP_RANGE="35.235.240.0/20"

if [ -z "$PROJECT" ]; then
  echo "no project: gcloud config set project <id>, or PROJECT=<id>" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
