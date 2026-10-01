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

Isaac Sim and Isaac ROS run on one GPU machine in GCP, and the page reaches it over an IAP tunnel. `gcp/env.sh` describes the machine: project from `gcloud config`, `us-central1-a`, a `g2-standard-8` (an L4 comes with it), 100 GB, Ubuntu 24.04 (Isaac ROS 5.0's tooling supports nothing older), no public address. Override any of it from the environment: `ZONE=europe-west4-b make gcp.up`, `SPOT=1 make gcp.up` for a preemptible box.

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
ZONE=us-central1-b SNAPSHOT=arm-20260930 make gcp.up   # the machine again in another zone, from a disk snapshot
```

A stopped on-demand machine is not guaranteed a GPU when it starts: a zone can be out of L4s, and the start is refused with STOCKOUT. It happened on the first morning. `gcp.up` retries a refused start once a minute for half an hour (`START_TRIES`). Past that, the way out is a snapshot of the disk (`gcloud compute snapshots create arm-<date> --source-disk arm --source-disk-zone <zone>`) and `gcp.up` with `ZONE` and `SNAPSHOT`, which recreates the machine in a zone that has one, with Isaac Sim and its caches intact; then set that zone in `gcp/env.sh` and delete the old instance. Keep a recent snapshot for this.

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

**The ROS 2 side** is the `ros2` feature, built by `bridge/Dockerfile.ros2` on the stock Jazzy image with `r2r`, and deployed with `ROS=1 make gcp.bridge`. For arm id `arm-a` the bridge publishes the joint targets its controller computes on `/arm_a/joint_commands` at the telemetry rate, and reads what the physics did from `/arm_a/joint_states`; that is what the hub is told, so the page draws Isaac Sim's arm. The arm on the other end is `sim/arm.urdf` (below). Fast DDS runs over UDP only on both sides: its shared-memory transport does not cross between containers.

The controller is told where the arm's joints physically are before every tick, and a step is done only once those are within `FOLLOWED` (0.02 rad) of the goal, or have stopped moving for half a second with the pad within `BLOCKED` (5 cm) of where the goal puts it, as a pad pressed onto a case top does; so the physics set the pace, not the servo model. The sensors read from there too. Cases, pallets and the belt under the pick zone and the drops are in the simulator too: the hub sends each arm's `Scene` with them, the bridge publishes it as JSON on `/<id>/cell` and the vacuum as a Bool on `/<id>/vacuum`, and `scene.py` spawns them as rigid bodies and, when the vacuum is on with a case just under the pad, holds it with a fixed joint until the vacuum lets go. A bridge that restarts under a running hub is greeted again by every station when the socket reopens, scene first. Switching an arm's link takes effect at once: the station seeds the new controller with the joints the old one reported, puts any case on the old pad back where it stood, and requeues the interrupted order, so the picture holds still and the new arm plans on from there. A pick or place is done once the vacuum has switched and the physical arm has come to rest, wherever the contact left it. The vacuum switches only once the physical arm is at the pose, or a case would be let go from wherever the physics still were. A physical arm has arrived when its pad is within `NEAR` (3 cm) of the goal, 10 cm through a swing, since gravity leaves a joint or two short however long it waits; a move stalled short of that for `STUCK` (2 s) is reported as a hold by contact, and the station plans again from where the arm is. Swings for an arm with a body go `SAG` (12 cm) higher than the model's, since it runs that much lower. Telemetry from the bridge carries the controller's `target` beside the physics' joints, and every `Link` says `where` it runs; the page draws the target as a small green outline at each embodied arm's pad, marks the notes of arms on the bridge, and says under the panel header how many arms are on the bridge and which have a body. Next on the bridge: cuMotion through MoveIt for swings round obstacles. Isaac ROS 5.0's Docker tooling is the `isaac-ros-cli` apt package (`sudo isaac-ros init docker`, `isaac-ros activate`), installed on the machine, with its image pulled; it comes in then.

## The arm in Isaac Sim

`sim/arm.urdf` is the controller's arm: the same link lengths as `LINK` in `client/src/model/constants.ts` and `bridge/controller/src/constants.rs`, and joints named and signed as the controller's own, `yaw`, `shoulder`, `elbow`, `wrist`, `roll`, so a joint target goes to the simulator as computed and a joint state comes back the same way. The URDF's frame is z up; the file's header says how it maps to the controller's. Change the three together.

`sim/scene.py` runs inside Isaac Sim on the machine: it imports the URDF with acceleration drives (a spring of 30 rad/s, a little over critically damped), spawns one arm per id, and wires each to its two topics, with one `/clock`. `make gcp.sim` ships `sim/` and starts it; `ARMS=arm-a,arm-b make gcp.sim` spawns more, 4 m apart. Verified: joint states at 62 Hz, and a held target reached to within gravity sag. Why our arm and not the Franka from the shipped MoveIt example: the hub plans for an arm that reaches 2.3 m, and a Franka reaches 0.85 m.

Rust over C++ because the bridge's own work is sockets and protobuf, where Rust's libraries are the best available, and because of that shared controller. ROS 2 is reached with `r2r`, and MoveIt through its action interfaces, which need no client library.

The bridge pings every hub and drops one silent for 20 s, so a page whose tunnel fell over is not counted for ever and the arms are cleared when the last real hub leaves. A station whose plan the arm refuses waits a second before the next, and over a refusal about what is held it takes the arm's word.

Two bridges share the one machine: `arm` for prod, built from `main`, and `arm-dev` for dev, built from whatever is checked out. Environments live in the containers and, later, in the two gateways in front of them; the GPU is one and Isaac Sim is one world, so dev waits when prod has it. With the tunnel up, set `KICL_ARM_BRIDGE_URL=http://localhost:3300` in Ki.CL's `.env`: its dev server sends `/arm/link` there and everything else about the page stays local, so the Physical AI switch puts the page's arms on the GCP machine.

## Perception

The arm's picture of its cell used to be the hub's word alone, and the simulator moved cases the hub never heard about, so a vacuum took whatever was under the pad while the hub believed it took something else. Now the picture flows back: the simulator publishes each cell on `/<arm>/seen` ten times a second, every case as a box in the arm's frame with its id, whatever else it sees as `others`, and the case on the pad as `held`. The bridge reads that JSON and relays it to the hub as a `Report.Seen`; the station moves any of its cases seen more than `DRIFT` (2 cm) from where it had them, notes one that has strayed past `STRAYED` (10 cm) once, and notes a pad holding a case the plan did not pick. The message is the contract: a perception stack that reads the camera over the cell (`/<arm>/camera/color`, `depth`, `camera_info`) and publishes the same JSON replaces the physics' word without a change anywhere else.

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
3. **GCP.** Done: the machine is up in `us-central1-a`, Isaac Sim 6.0.0 runs a stock Franka headless on its L4 with caches persisted. Isaac ROS comes with the bridge.
4. **Bridge, Rust.** Done as far as the wire, the simulated arm, and the ROS 2 side driving our arm in Isaac Sim by joint targets with the physics setting the pace. Cases and the vacuum are in the simulator (2026-09-30). Next: cuMotion through MoveIt for swings round obstacles.
5. **Sim content.** The arm, its pallets and cases are done (`sim/`). Next the hex floor and belts as USD, and obstacles from `Scene` so the panel's obstacle editor works against the sim.
6. **Perception.** The contract is in place (2026-09-30): each cell says what it sees on `/<arm>/seen` (cases as boxes by id, whatever else stands there, the case on the pad), the bridge relays it to the hub as a `seen` report, and the station moves its cases to where they are seen and says when one has strayed, so the next plan starts from where things are. Today the simulator's physics say it; a camera over each cell (`CAMERA=1 make gcp.sim`) publishes colour, depth and its intrinsics on `/<arm>/camera/*` for FoundationPose (case poses) and nvblox (everything else) to say the same thing on the same topic. It is off by default: rendering it every step drops the physics from 60 Hz to about 36, and the arm then runs slower than its model. Next: those two, as Isaac ROS graphs on the machine.
7. **Later.** A real arm behind the same bridge, and an Isaac Lab policy proposing placements that the station's stability check still has the last word on.
