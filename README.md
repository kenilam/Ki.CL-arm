# Ki.CL-arm

Everything about the robots on the [Ki.CL](https://github.com/kenilam/Ki.CL) robotic-arm floor and their brains, classic and physical AI alike. That covers the `arm` federated remote the floor loads, the frame schema, the Rust bridge that serves both, and the GCP machine.

The floor itself (the world, its meshes and the panel) lives in Ki.CL under `App/views/experiments/robotic-arm`. Its `README.md` holds the design decisions and is the reference for both repos.

```bash
make install    # yarn, for the remote and buf
make run        # the remote, rebuilt as it changes, and the bridge serving it on 127.0.0.1:3200
make test       # the remote's tests, then the bridge's
make typecheck
make codegen    # the wire's code from proto/: TypeScript for the remote, Python for the twin
make assets     # the arm for Isaac and cuMotion, from client/src/robot/spec.ts, into sim/robot
make test.twin  # the twin's brain, pool and socket, without Isaac, in sim/.venv
make lint       # buf lint
```

The bridge needs a Rust toolchain (`rustup`). It compiles the schema itself with `protox`, so no `protoc` is needed.

## The remote

`client/` builds the `arm` Module Federation remote, the way Ki.CL-back serves its GraphQL client as `api`:

- `arm/robot`: the arm's joints, links and forward kinematics.
- `arm/grid`: the hex grid and the arm cells on it.
- `arm/frames`: the sensor and command frames between a robot and its brain.
- `arm/brains`: what the floor calls. It routes each robot to its classic brain, which runs in a few workers, or across the link to physical AI, and hands a robot over when it changes side (`handover.ts`). The protobuf codec and the jitter buffer sit behind it.

Its base is `/arm/client/`. The bridge serves the build there, and Ki.CL proxies `/arm` onto its own origin, which is what lets the page start the brain workers.

## The wire

`proto/kicl/robot/v1/robot.proto` mirrors `client/src/frames.ts`. Change the two together, then run `make codegen` to regenerate the remote's TypeScript.

One WebSocket at `/arm/link` carries every robot on a page. Each socket frame is one protobuf message, with no length prefix.

- Page to bridge (`ToBridge`): `attach` a robot (an AMR comes with its map), `detach` one, or a `sensors` batch with every attached robot's frame for one bus tick.
- Bridge to page (`FromBridge`): the commands answering one batch, each tagged with the tick it answers.

The page holds commands from the link two ticks behind its own clock, so uneven arrival lands on a steady beat.

WebSocket and protobuf, not gRPC: a browser cannot speak native gRPC, and gRPC-Web has no bidirectional streaming. GraphQL stays the control plane in Ki.CL-back and never carries frames.

## The bridge

`bridge/` is a Rust crate (tokio, axum, prost). It serves `/health`, the remote's build at `/arm/client/*` (`BRIDGE_CLIENT` moves it from `../client/dist`), and `/arm/link`.

With `BRIDGE_UPSTREAM` set to the twin's socket, each page socket on `/arm/link` is relayed to it frame for frame. The twin speaks the same frames, so the bridge doesn't decode them. Without an upstream, or while the twin cannot be reached, the bridge answers every robot on the link by holding still. An arm keeps its joints and vacuum, so a held case is never dropped.

```bash
make gcp.tunnel   # the twin on localhost:3300
make run          # the bridge, relaying to it (BRIDGE_UPSTREAM defaults to the tunnel)
```

`make run` and `make gcp.tunnel` stop whatever already listens on their local port first (`scripts/free-port.sh`), usually the copy left running from last time.

It listens on loopback by default. In production it becomes the front door: on Cloud Run, gated, serving the remote to every page and relaying robots switched to physical AI to the GPU machine over the VPC. That way the floor loads while the GPU machine sleeps.

## The twin

`sim/` is physical AI running in Isaac Sim 6.0 on the GPU machine. `make gcp.twin` uploads it and runs it in Isaac's container, answering `/arm/link` on port 3200 there.

One stage holds several rigs (`--rigs`, 4 by default), 20 m apart, each an arm with its own cell and its own RMPflow. A page socket is a session, and each arm a session attaches leases a free rig (`sim/twin/pool.py`). When the session detaches the arm or hangs up, the rig resets to an empty cell with the arm at home, a new arm for the next page. Two pages never share a rig. An arm attached while every rig is leased gets hold-still answers. Rigs are built before physics plays and only reset afterwards, because adding or removing an articulation while PhysX runs breaks its views.

- `sim/robot/`: the arm as URDF, cuMotion's XRDF (joints, home pose, the pad as the tool, collision spheres) and RMPflow's tuning, all written by `make assets` from the same spec the floor draws. A test in the remote checks that the URDF puts the pad where the floor does. Commit what `make assets` writes.
- `sim/twin/scene.py`: Isaac's side. It holds the arm imported from the URDF, the cell mirrored from the floor's vision, PhysX, and cuMotion's RMPflow driving the pad to each target. Physics runs on the CPU, because the cell gains and loses cases while it runs, which PhysX's GPU views do not allow. A case the floor owns is kinematic and sits where the camera saw it. A case the twin grips follows the pad with its collisions off. Once let go, it is dynamic and PhysX settles it. Cases that leave the cell are parked under the floor rather than removed, because removing a prim while physics plays breaks PhysX's views.
- `sim/twin/planner.py` and `placement.py`: which case, where it goes, and the pad's waypoints, the same rules as the classic brain. A target is turned half a turn when that keeps the flange inside its range, since a case sits the same either way round.
- `sim/twin/twin.py`: the brain. Each frame updates the mirror and is answered with the twin's joint positions and vacuum, which the floor's drives follow. Robots it isn't driving get a hold-still answer. When a page hangs up, or attaches its arm again, the twin drops the arm and clears the cell, so a reloaded page starts afresh. An attach that carries a handover starts the twin from it: Isaac's joints and joint speeds set to the snapshot, and the held case kept under the pad.
- `sim/twin/check.py`: sets known poses in Isaac and prints the pad against the spec, for checking an import by hand.

Each pick and place takes about 30 seconds. The twin has no live obstacle avoidance yet: like the classic brain, it travels at a height clear of everything the camera sees.

## GCP

`gcp/` and the `gcp.*` make targets manage the machine: one `g2-standard-8` with an L4, no public IP, reached over IAP. `make gcp.up`, `gcp.down`, `gcp.tunnel` (localhost:3300 onto the machine). The machine stops itself after 30 idle minutes.

`make gcp.twin` deploys the twin, and `make gcp.isaac.log` tails it. The old bridge's containers on the machine (`arm`, `arm-dev`) are stopped with their restart turned off; their images are still there.
