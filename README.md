# Ki.CL-arm

The wire between the [Ki.CL](https://github.com/kenilam/Ki.CL) factory-arm hub and its arms, and, in time, the bridge that puts a real or NVIDIA Isaac arm on the far end of it.

Three things live here:

- `proto/`: the schema for the wire, `kicl/arm/v1/arm.proto`.
- `client/`: the arm package (protocol, model, grid, controller, station, hub), built as a Module Federation remote named `arm`. It knows nothing about any page: a host hands the hub a `Floor`, plain data with the arms, belt lines, pallets, capacities and obstacles, and the hub builds itself from it. Ki.CL imports it as `arm/hub`, `arm/grid/hex` and so on, the way it imports Ki.CL-back's GraphQL client as `api`. What a page does with it, such as its preset floors, its editor's placement rules and how it draws the arm, stays in the page.
- `server/`: the development server. It serves the built remote at `/arm/*` and runs the simulated controllers behind the wire at `/arm/link`.

```bash
make install
make run        # builds the remote, rebuilds it as it changes, serves it and the simulated arms on :3200
make test       # 49 node:test suites across the client
make typecheck
make codegen    # TypeScript for the wire from proto/
make lint       # buf lint
```

Ki.CL's dev server proxies `/arm` to `http://localhost:3200` (`KICL_ARM_URL`), so run `make run` here beside `make run` there. The proxy is not a convenience: the hub and each controller run in workers, and a worker script has to load from the page's own origin.

## The wire

`proto/kicl/arm/v1/arm.proto` mirrors `client/src/protocol`. Change the two together.

One WebSocket carries every arm. Each frame is one protobuf message, no length prefix, because the socket already delimits frames.

- Hub to arm: `ToArm`, either a `Command` (`load` a plan, `hold`, `resume`, `stop`, `reset`, `open` a gate) or a `Scene`, the boxes round a simulated arm for its sensors to meet. A real arm ignores `Scene`.
- Arm to hub: `Report`, either `Telemetry` at a steady rate (60 Hz in the simulator) or one of `loaded`, `rejected`, `progress`, `done`, `held`, `resumed`, `stopped`, `reset`.

The hub plans in pad poses and case ids and sends whole plans. The arm turns them into joint motion on its own and reports back. So a slow link only delays when a plan starts, never how it runs. A `gate` in a plan holds the arm until the hub opens it, which is how the arm waits for a belt without knowing there is a belt.

Why WebSocket and protobuf rather than gRPC or GraphQL: a browser cannot speak native gRPC and gRPC-Web has no bidirectional streaming, so gRPC would cost a proxy and give nothing back. GraphQL stays as the control plane in Ki.CL-back (which cell, tokens, saved floors) and never sits on the hot path. A telemetry frame is about 130 bytes in protobuf against roughly twice that in JSON.

## Consumers

`make codegen` writes the TypeScript for the wire into `client/src/protocol/wire/gen` with a remote `protoc-gen-es` plugin, so nothing to install. The generated file is committed. The C++ bridge will generate its own from the same file when it arrives here.

Ki.CL gets its types for `arm/*` from the remote's `@mf-types.zip`, pulled by the Module Federation plugin at dev start into `App/@mf-types/arm`. The watch rebuild does not regenerate types; a full build does, and `make run` starts with one. After changing anything Ki.CL imports, run `make build` here and restart Ki.CL's dev server so it pulls the new types.

## The arm side of the wire, today

- `client/src/protocol/wire`: the codec between the hub's TypeScript types and the wire.
- `client/src/controller/remote.ts`: the hub's `Link` over a socket. One socket, one link per arm. It takes a path such as `/arm/link` on the page's own origin, or a full `ws://` address. Commands queue while the socket is down and only the last scene per arm is kept.
- `server/index.ts`: the simulated controller behind the wire, and the reference for what the bridge has to do. An arm keeps running when a hub goes away, so its telemetry carries the last plan revision it accepted and a new hub numbers its plans after it.
- Ki.CL's floor reads `KICL_ARM_LINK` (for example `/arm/link`) and shows a Physical AI button in its panel. On, the arms are on the socket. Off, they run in workers on the page.

## The GCP machine

Isaac Sim and Isaac ROS run on one GPU machine in GCP, and the page reaches it over an IAP tunnel. `gcp/env.sh` describes the machine: project from `gcloud config`, `us-central1-c`, a `g2-standard-8` (an L4 comes with it), 100 GB, Ubuntu 24.04 (Isaac ROS 5.0's tooling supports nothing older), no public address. Override any of it from the environment: `ZONE=europe-west4-b make gcp.up`, `SPOT=1 make gcp.up` for a preemptible box.

```bash
gcloud auth login
make gcp.quota    # L4s in the region and GPUs anywhere; both start at 0 and a request can take a day
make gcp.up       # APIs, the IAP-only firewall rule, Cloud NAT, a nightly stop, then the machine; run again to start it
make gcp.status   # state, and the tail of what the startup script said
make gcp.ssh      # a shell there, over IAP
NGC_API_KEY=… make gcp.ngc   # the key into Secret Manager, the machine allowed to read it, and its Docker logged in to nvcr.io
make gcp.tunnel   # localhost:3200 -> the machine's 3200
make gcp.isaac    # a command in Isaac Sim's container there, detached; none = the stock Franka example, headless
make gcp.isaac.log
make gcp.down     # stop; the disk stays. make gcp.delete takes it all away
```

First boot installs the NVIDIA driver, reboots once, then installs Docker and the NVIDIA container toolkit, proves a container can see the GPU, and sets up the idle watchdog: a timer that stops the machine after 30 minutes with no connection on the bridge's port and no ssh session. `make gcp.status` shows it happen. The machine stops itself at 22:00 (`STOP_AT`, `TIMEZONE`) so a forgotten box costs an evening, not a month; it bills whenever it is up.

`make gcp.isaac` runs a command in the Isaac Sim 6.0.0 container on the machine, detached, with the simulator's caches kept under `/var/lib/arm/isaac` between runs; `make gcp.isaac.log` tails its log. With no command it runs the stock Franka follow-target example headless for a fixed number of frames, which is how the GPU and the simulator were proven. Two things the NVIDIA container docs do not say for this version: the image runs as user `isaac-sim` (uid 1234) with its home at `/isaac-sim`, so the cache mounts go under that home, not `/root`, and the folders on the machine have to belong to that uid. Root-owned folders gave "Failed to acquire exclusive lock to data store" and an RTX shader cache failure, and nothing was cached.

With the tunnel open, Ki.CL needs no change: its `/arm` proxy already points at `localhost:3200`, so whatever listens on the machine's 3200 is what the page's arms talk to. For now that can be this repo's own dev server; later it is the bridge. The Isaac Sim viewport streams over WebRTC, which needs UDP, and IAP is TCP only; Tailscale on the machine is the plan for when we want to look at the sim itself.

## The bridge

`bridge/` is a Cargo workspace, in Rust:

- `wire`: the wire's messages, generated from `proto/` at build time with a bundled `protoc`, so nothing is installed for it.
- `controller`: one arm's controller, ported line for line from `client/src/controller` and `client/src/model/kinematics.ts`. Same plans in, same joints and reports out, same tests. It has no dependencies, so it compiles for the machine and for Wasm alike; the plan is for the browser workers to run this crate instead of the TypeScript copy, so the simulated arm and the bridge can never disagree on the protocol again.
- `bridge`: the binary. One WebSocket, every frame one protobuf message, an arm behind each id the hub names. Today every arm is the simulated controller; Isaac's arms come in behind the same ids through ROS 2 next. Arms come into being on the first message that names them and go when the last hub does.

```bash
make bridge.test    # cargo test across the workspace
make bridge.run     # the bridge here, on 127.0.0.1:3201
make gcp.bridge     # build it on the machine in Docker and run it there as `arm` on :3200, restarting with the machine
STAGE=dev make gcp.bridge   # the same from this checkout, as `arm-dev` on :3201
make gcp.bridge.log         # STAGE picks which
make gcp.tunnel     # localhost:3300 -> the machine's 3200; STAGE=dev -> 3201
```

`bridge/Dockerfile.ros2` is the draft for the ROS 2 flavour: the Isaac ROS development image as base, Rust and `r2r` on top, built with ROS sourced. Isaac ROS 5.0 moved its Docker tooling out of `isaac_ros_common` into the `isaac-ros-cli` apt package (`sudo isaac-ros init docker`, `isaac-ros activate`), which the machine's startup script installs; the base image's name comes from there.

Rust over C++ because the bridge's own work is sockets and protobuf, where Rust's libraries are the best available, and because of that shared controller. ROS 2 is reached with `r2r`, and MoveIt through its action interfaces, which need no client library.

Two bridges share the one machine: `arm` for prod, built from `main`, and `arm-dev` for dev, built from whatever is checked out. Environments live in the containers and, later, in the two gateways in front of them; the GPU is one and Isaac Sim is one world, so dev waits when prod has it. With the tunnel up, set `KICL_ARM_BRIDGE_URL=http://localhost:3300` in Ki.CL's `.env`: its dev server sends `/arm/link` there and everything else about the page stays local, so the Physical AI switch puts the page's arms on the GCP machine.

## Going public: the gateway

Nothing here is public yet: the machine answers only to IAP and the bridge only inside the VPC. When the experiment goes public, this is the shape, agreed 2026-09-29:

- **The machine is for Isaac sessions only.** It stops itself nightly and after 30 minutes with no hub on the bridge (10 with nobody switched over). Standing cost is the disk and NAT; the L4 bills by the hour it is actually used.
- **A front door in this repo**, the dev server with a production mode on Cloud Run, scaled to zero: it serves the built remote at `/arm/*`, proxies `/arm/link` to the machine's internal address over Direct VPC egress, and offers `POST /arm/wake` (starts the machine through the Compute API with a service account allowed to start that one instance) and `GET /arm/status` (machine running, bridge answering).
- **Waking.** When a visitor loads a simulation, the page asks for a wake; the button shows a spinner until the hub's dial of `/arm/link` gets its first telemetry, about two minutes from cold; then the robot icon appears and the visitor chooses to switch. The local workers run the whole time.
- **Every public call is gated.** The browser holds no secret. Ki.CL's own server proxies `/arm` and mints a Google ID token per call, the way it already does for `/api`; the gateway runs `--no-allow-unauthenticated`. `/arm/wake` also needs the visitor's Turnstile-backed session token from Ki.CL-back, verified by signature, and a global rate limit on starts. The bridge checks a bearer on the WebSocket handshake that only the gateway holds. Isaac Sim's viewport is never exposed.
- **One machine, many visitors.** The bridge namespaces arms per connection for the simulated controller; a single Isaac Sim world admits one visitor at a time.

## Plan

1. **Wire.** Schema, codegen, remote link, reference bridge. Done.
2. **Federate the arm code.** Done: `client/` is the `arm` remote, Ki.CL keeps the floor page and everything only a page needs. Workers load through Ki.CL's `/arm` proxy.
3. **GCP.** Done: the machine is up in `us-central1-c`, Isaac Sim 6.0.0 runs a stock Franka headless on its L4 with caches persisted. Isaac ROS comes with the bridge.
4. **Bridge, Rust.** Done as far as the wire and the simulated arm: `bridge/` above. Next, the ROS 2 side through `r2r`: each `move` becomes a cuMotion goal through MoveIt's actions, `pick` and `place` drive the gripper, `gate` and `hold` pause the trajectory, `stop` is the controller manager's emergency stop, `/joint_states` comes back as `Telemetry`.
5. **Sim content.** The arm as a URDF from the link lengths in `client/src/model/constants.ts`, the hex floor and belts as USD, and `Scene` spawning cases and obstacles so the panel's obstacle editor still works against the sim.
6. **Perception.** Isaac Sim cameras through Isaac ROS, FoundationPose for case poses, nvblox for the obstacle map cuMotion plans around. Detected obstacles come back as boxes so the floor draws what the arm saw.
7. **Later.** A real arm behind the same bridge, and an Isaac Lab policy proposing placements that the station's stability check still has the last word on.
