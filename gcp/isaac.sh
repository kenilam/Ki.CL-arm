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
# MOUNTS=0 runs without the cache volumes, to tell a mount problem from a container one.
MOUNTS="${MOUNTS:-1}"

command="${*:-cd /isaac-sim && sed 's/\"headless\": False/\"headless\": True/' standalone_examples/api/isaacsim.robot.experimental.manipulators/franka/follow_target_with_rmpflow.py > /tmp/follow.py && ./python.sh /tmp/follow.py --test}"

# The 6.0 image runs as user isaac-sim (uid 1234) with its home at /isaac-sim, not root: the caches live
# under that home, and the folders on the machine have to belong to that uid or nothing gets written.
UID_IN=1234
volumes=""
if [ "$MOUNTS" = 1 ]; then
  volumes="-v $STORE/cache/kit:/isaac-sim/kit/cache:rw -v $STORE/cache/ov:/isaac-sim/.cache/ov:rw -v $STORE/cache/pip:/isaac-sim/.cache/pip:rw -v $STORE/cache/warp:/isaac-sim/.cache/warp:rw -v $STORE/cache/glcache:/isaac-sim/.cache/nvidia/GLCache:rw -v $STORE/cache/computecache:/isaac-sim/.nv/ComputeCache:rw -v $STORE/logs:/isaac-sim/.nvidia-omniverse/logs:rw -v $STORE/data:/isaac-sim/.local/share/ov/data:rw"
fi

# ROS 2 for the simulator's bridge: the Jazzy libraries the container bundles, and Fast DDS over UDP only.
# Its shared-memory transport does not cross between containers run as different users, so without this
# profile the simulator's topics are listed by other containers but no data ever arrives. The profile is
# the one the Isaac ROS CLI installs on the machine, so both sides read the same file.
MIDDLEWARE=/etc/isaac-ros-cli/docker/middleware_profiles
ros="-e ROS_DISTRO=jazzy -e RMW_IMPLEMENTATION=rmw_fastrtps_cpp -e ROS_DOMAIN_ID=0 -e LD_LIBRARY_PATH=/isaac-sim/exts/isaacsim.ros2.core/jazzy/lib -e FASTRTPS_DEFAULT_PROFILES_FILE=/arm/middleware/rtps_udp_profile.xml -v $MIDDLEWARE:/arm/middleware:ro"

# The script that runs on the machine, as root. %q quotes the command so it survives the trip whole.
run="$(
  printf '#!/usr/bin/env bash\nCOMMAND=%q\n' "$command"
  cat <<EOF
mkdir -p $STORE/cache/{kit,ov,pip,warp,glcache,computecache} $STORE/{logs,data}
chown -R $UID_IN:$UID_IN $STORE/cache $STORE/logs $STORE/data
exec docker run --rm --gpus all --network host \\
  -e ACCEPT_EULA=Y -e PRIVACY_CONSENT=Y \\
  $ros \\
  $volumes \\
  --entrypoint bash $IMAGE -c "\$COMMAND"
EOF
)"

printf '%s\n' "$run" | gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command \
  "sudo mkdir -p $STORE && sudo tee $STORE/run.sh >/dev/null && sudo sh -c 'nohup bash $STORE/run.sh > $STORE/run.log 2>&1 &' && sleep 4 && sudo docker ps --format '{{.Image}} {{.Status}}' | grep isaac-sim || sudo tail -n 5 $STORE/run.log" \
  2>/dev/null
