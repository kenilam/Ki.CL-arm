#!/usr/bin/env bash
# The machine, from nothing: APIs on, a firewall rule that lets only IAP in,
# the instance with no public address, and a nightly stop. Run again, it
# starts a stopped machine and leaves the rest alone.
source "$(dirname "$0")/env.sh"

gcloud services enable compute.googleapis.com iap.googleapis.com --project "$PROJECT" >/dev/null

if ! gcloud compute firewall-rules describe "$TAG-iap" --project "$PROJECT" >/dev/null 2>&1; then
  echo "firewall: $TAG-iap (ssh and $PORT, from IAP only)"
  gcloud compute firewall-rules create "$TAG-iap" \
    --project "$PROJECT" \
    --direction INGRESS \
    --source-ranges "$IAP_RANGE" \
    --target-tags "$TAG" \
    --allow "tcp:22,tcp:$PORT" >/dev/null
fi

if ! gcloud compute resource-policies describe "$TAG-stop" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  echo "schedule: stop at $STOP_AT:00 $TIMEZONE"
  gcloud compute resource-policies create instance-schedule "$TAG-stop" \
    --project "$PROJECT" \
    --region "$REGION" \
    --timezone "$TIMEZONE" \
    --vm-stop-schedule "0 $STOP_AT * * *" >/dev/null
fi

status="$(gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$PROJECT" --format='value(status)' 2>/dev/null || true)"

case "$status" in
  RUNNING)
    echo "$NAME is running"
    ;;
  TERMINATED | STOPPED)
    echo "starting $NAME"
    gcloud compute instances start "$NAME" --zone "$ZONE" --project "$PROJECT" >/dev/null
    ;;
  "")
    echo "creating $NAME: $MACHINE in $ZONE, ${DISK_GB}GB, $( [ "$SPOT" = 1 ] && echo spot || echo on-demand )"
    provisioning=()
    if [ "$SPOT" = 1 ]; then
      provisioning=(--provisioning-model SPOT --instance-termination-action STOP)
    fi
    gcloud compute instances create "$NAME" \
      --project "$PROJECT" \
      --zone "$ZONE" \
      --machine-type "$MACHINE" \
      --maintenance-policy TERMINATE \
      --no-address \
      --tags "$TAG" \
      --image-family "$IMAGE_FAMILY" \
      --image-project "$IMAGE_PROJECT" \
      --boot-disk-size "${DISK_GB}GB" \
      --boot-disk-type pd-balanced \
      --metadata-from-file startup-script="$here/startup.sh" \
      --resource-policies "$TAG-stop" \
      --scopes cloud-platform \
      "${provisioning[@]}" >/dev/null
    echo "first boot installs the driver and reboots once; make gcp.status shows the serial log"
    ;;
  *)
    echo "$NAME is $status; wait and run again"
    exit 1
    ;;
esac
