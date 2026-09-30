#!/usr/bin/env bash
# Runs on the machine at every boot. The first time it installs the NVIDIA
# driver, Docker and the NVIDIA container toolkit and reboots once; after
# that it only checks the GPU is there. Progress goes to the serial console:
# `make gcp.status` prints the tail.
set -euo pipefail

MARK=/var/lib/arm/ready
log() { echo "arm-startup: $*"; }

if [ -f "$MARK" ]; then
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || log "GPU missing"
  log "ready"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg ubuntu-drivers-common

if ! command -v nvidia-smi >/dev/null; then
  log "installing the NVIDIA driver"
  ubuntu-drivers install --gpgpu
  mkdir -p "$(dirname "$MARK")"
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

mkdir -p "$(dirname "$MARK")"
touch "$MARK"
log "ready"
