#!/usr/bin/env bash
# Runs a command inside Isaac Sim's container on the machine, detached, with
# the simulator's caches on the machine's disk so shaders and assets survive
# between runs. Output lands in /var/lib/arm/isaac/run.log there; `make
# gcp.isaac.log` tails it here. With no command, it runs the stock Franka
# follow-target example headless for a fixed number of frames: the proof
# that the simulator drives an arm on this GPU.
source "$(dirname "$0")/env.sh"

IMAGE="${IMAGE:-nvcr.io/nvidia/isaac-sim:6.0.0}"
STORE=/var/lib/arm/isaac

command="${*:-cd /isaac-sim && sed 's/\"headless\": False/\"headless\": True/' standalone_examples/api/isaacsim.robot.experimental.manipulators/franka/follow_target_with_rmpflow.py > /tmp/follow.py && ./python.sh /tmp/follow.py --test}"

# The script that runs on the machine, as root. %q quotes the command so it survives the trip whole.
run="$(
  printf '#!/usr/bin/env bash\nCOMMAND=%q\n' "$command"
  cat <<EOF
mkdir -p $STORE/cache/{kit,ov,pip,glcache,computecache} $STORE/{logs,data}
exec docker run --rm --gpus all --network host \\
  -e ACCEPT_EULA=Y -e PRIVACY_CONSENT=Y \\
  -v $STORE/cache/kit:/isaac-sim/kit/cache:rw \\
  -v $STORE/cache/ov:/root/.cache/ov:rw \\
  -v $STORE/cache/pip:/root/.cache/pip:rw \\
  -v $STORE/cache/glcache:/root/.cache/nvidia/GLCache:rw \\
  -v $STORE/cache/computecache:/root/.nv/ComputeCache:rw \\
  -v $STORE/logs:/root/.nvidia-omniverse/logs:rw \\
  -v $STORE/data:/root/.local/share/ov/data:rw \\
  --entrypoint bash $IMAGE -c "\$COMMAND"
EOF
)"

printf '%s\n' "$run" | gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command \
  "sudo mkdir -p $STORE && sudo tee $STORE/run.sh >/dev/null && sudo sh -c 'nohup bash $STORE/run.sh > $STORE/run.log 2>&1 &' && sleep 4 && sudo docker ps --format '{{.Image}} {{.Status}}' | grep isaac-sim || sudo tail -n 5 $STORE/run.log" \
  2>/dev/null
