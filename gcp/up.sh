#!/usr/bin/env bash
# The machine, from nothing: APIs on, a firewall rule that lets only IAP in,
# NAT so the machine can reach out, the instance with no public address, and
# a nightly stop. Run again, it
# starts a stopped machine and leaves the rest alone.
source "$(dirname "$0")/env.sh"

gcloud services enable compute.googleapis.com iap.googleapis.com secretmanager.googleapis.com --project "$PROJECT" >/dev/null

allow="tcp:22,$(echo "$PORTS" | sed 's/\([0-9]*\)/tcp:\1/g')"
if ! gcloud compute firewall-rules describe "$TAG-iap" --project "$PROJECT" >/dev/null 2>&1; then
  echo "firewall: $TAG-iap (ssh and $PORTS, from IAP only)"
  gcloud compute firewall-rules create "$TAG-iap" \
    --project "$PROJECT" \
    --direction INGRESS \
    --source-ranges "$IAP_RANGE" \
    --target-tags "$TAG" \
    --allow "$allow" >/dev/null
else
  gcloud compute firewall-rules update "$TAG-iap" --project "$PROJECT" --allow "$allow" >/dev/null
fi

# No public address means no way out either: apt, Docker's and NVIDIA's registries all sit behind this.
if ! gcloud compute routers describe "$TAG-router" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  echo "nat: $TAG-nat for $REGION"
  gcloud compute routers create "$TAG-router" --network default --region "$REGION" --project "$PROJECT" >/dev/null
  gcloud compute routers nats create "$TAG-nat" \
    --router "$TAG-router" \
    --region "$REGION" \
    --project "$PROJECT" \
    --auto-allocate-nat-external-ips \
    --nat-all-subnet-ip-ranges >/dev/null
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
    # Expanded with the ${arr[@]+...} form: macOS bash treats an empty array as unbound under set -u.
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
      --metadata "ngc-secret=$NGC_SECRET" \
      --metadata-from-file startup-script="$here/startup.sh" \
      --resource-policies "$TAG-stop" \
      --scopes cloud-platform \
      ${provisioning[@]+"${provisioning[@]}"} >/dev/null
    echo "first boot installs the driver and reboots once; make gcp.status shows the serial log"
    ;;
  *)
    echo "$NAME is $status; wait and run again"
    exit 1
    ;;
esac
