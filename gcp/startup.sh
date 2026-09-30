#!/usr/bin/env bash
# Runs on the machine at every boot. The first time it installs the NVIDIA
# driver, Docker and the NVIDIA container toolkit and reboots once; after
# that it only checks the GPU is there. Progress goes to the serial console:
# `make gcp.status` prints the tail.
set -euo pipefail

MARK=/var/lib/arm/ready
log() { echo "arm-startup: $*"; }

if [ -f "$MARK" ] && [ -f /etc/systemd/system/arm-idle.timer ]; then
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || log "GPU missing"
  log "ready"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg ubuntu-drivers-common

DRIVER_MARK=/var/lib/arm/driver

if ! command -v nvidia-smi >/dev/null; then
  if [ -f "$DRIVER_MARK" ]; then
    log "the driver was installed and rebooted into, yet nvidia-smi is missing; stopping here"
    exit 1
  fi

  # The recommended server driver, by name, so nvidia-smi comes with it: `--gpgpu` alone leaves the utilities out.
  driver="$(ubuntu-drivers devices 2>/dev/null | grep -oE 'nvidia-driver-[0-9]+-server' | sort -u | tail -n 1)"
  driver="${driver:-nvidia-driver-570-server}"
  log "installing $driver"
  apt-get install -y "$driver" "${driver/driver/utils}"
  mkdir -p "$(dirname "$DRIVER_MARK")"
  touch "$DRIVER_MARK"
  log "rebooting for the driver"
  reboot
  exit 0
fi

if ! command -v docker >/dev/null; then
  log "installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! command -v nvidia-ctk >/dev/null; then
  log "installing the NVIDIA container toolkit"
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -sL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -y
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi

# Isaac Sim and Isaac ROS run as containers; the whole point of the machine is the GPU inside them.
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi --query-gpu=name --format=csv,noheader

# Those containers come from NVIDIA's registry. The key sits in Secret Manager and the machine's own account reads it, so it never travels through a laptop.
secret="$(curl -sf -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/attributes/ngc-secret || true)"
if [ -n "$secret" ] && key="$(gcloud secrets versions access latest --secret "$secret" 2>/dev/null)"; then
  printf '%s' "$key" | docker login nvcr.io --username '$oauthtoken' --password-stdin >/dev/null && log "logged in to nvcr.io"
else
  log "no NGC key in Secret Manager yet (secret: ${secret:-unset}); make gcp.ngc puts one there"
fi

# The idle watchdog: with no hub on the bridge and no ssh session for IDLE minutes, the machine stops itself.
# A stopped machine bills only its disk, so a forgotten afternoon costs nothing. `make gcp.up` starts it again.
cat > /usr/local/bin/arm-idle <<'WATCH'
#!/usr/bin/env bash
IDLE_MINUTES=${IDLE_MINUTES:-30}
STAMP=/run/arm-idle-since
busy=0
ss -Htn state established '( sport = :3200 )' | grep -q . && busy=1
ss -Htn state established '( sport = :22 )' | grep -q . && busy=1
if [ "$busy" = 1 ]; then rm -f "$STAMP"; exit 0; fi
[ -f "$STAMP" ] || date +%s > "$STAMP"
idle=$(( ($(date +%s) - $(cat "$STAMP")) / 60 ))
if [ "$idle" -ge "$IDLE_MINUTES" ]; then
  echo "arm-idle: nothing on the bridge or ssh for $idle minutes; stopping"
  shutdown -h now
fi
WATCH
chmod +x /usr/local/bin/arm-idle
cat > /etc/systemd/system/arm-idle.service <<'UNIT'
[Unit]
Description=Stop the machine when nobody has used the arm for a while
[Service]
Type=oneshot
ExecStart=/usr/local/bin/arm-idle
UNIT
cat > /etc/systemd/system/arm-idle.timer <<'UNIT'
[Unit]
Description=Check every minute whether the arm is idle
[Timer]
OnBootSec=5min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now arm-idle.timer
log "idle watchdog on"

mkdir -p "$(dirname "$MARK")"
touch "$MARK"
log "ready"
