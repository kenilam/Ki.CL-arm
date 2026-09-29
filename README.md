# Ki.CL-arm

The wire between the [Ki.CL](https://github.com/kenilam/Ki.CL) factory-arm hub and its arms, and, in time, the bridge that puts a real or NVIDIA Isaac arm on the far end of it.

Today the repo holds the schema. The hub, the stations, the simulated controller and the browser floor still live in Ki.CL under `App/views/experiments/factory-arm`. The plan below moves the arm-side code here.

```bash
yarn            # installs buf
yarn lint       # buf lint
yarn breaking   # against main
```

## The wire

`proto/kicl/arm/v1/arm.proto` mirrors `cell/protocol` in Ki.CL. Change the two together.

One WebSocket carries every arm. Each frame is one protobuf message, no length prefix, because the socket already delimits frames.

- Hub to arm: `ToArm`, either a `Command` (`load` a plan, `hold`, `resume`, `stop`, `reset`, `open` a gate) or a `Scene`, the boxes round a simulated arm for its sensors to meet. A real arm ignores `Scene`.
- Arm to hub: `Report`, either `Telemetry` at a steady rate (60 Hz in the simulator) or one of `loaded`, `rejected`, `progress`, `done`, `held`, `resumed`, `stopped`, `reset`.

The hub plans in pad poses and case ids and sends whole plans. The arm turns them into joint motion on its own and reports back. So a slow link only delays when a plan starts, never how it runs. A `gate` in a plan holds the arm until the hub opens it, which is how the arm waits for a belt without knowing there is a belt.

Why WebSocket and protobuf rather than gRPC or GraphQL: a browser cannot speak native gRPC and gRPC-Web has no bidirectional streaming, so gRPC would cost a proxy and give nothing back. GraphQL stays as the control plane in Ki.CL-back (which cell, tokens, saved floors) and never sits on the hot path. A telemetry frame is about 130 bytes in protobuf against roughly twice that in JSON.

## Consumers

Ki.CL generates TypeScript from this schema with `make codegen` (`buf generate` with a remote `protoc-gen-es` plugin, so nothing to install). It reads the schema from this repo on GitHub, or from a checkout beside it with `make codegen ARM_PROTO=../Ki.CL-arm/proto`. The generated file is committed there.

The C++ bridge will generate its own from the same file when it arrives here.

## What is in Ki.CL today

- `cell/protocol/wire`: the codec between the hub's TypeScript types and the wire.
- `cell/controller/remote.ts`: the hub's `Link` over a socket. One socket, one link per arm. Commands queue while the socket is down and only the last scene per arm is kept.
- `cell/controller/serve.ts`: the simulated controller behind the wire as a Node process, `make arm.serve`. It is what the floor dials when there is no bridge yet, and the reference for what the bridge has to do.
- The floor reads `KICL_ARM_LINK` (for example `ws://localhost:8765`) and shows a Physical AI button in its panel. On, the arms are on the bridge at that address. Off, they run in workers on the page.

## Plan

1. **Wire.** Schema, codegen, remote link, reference bridge. Done.
2. **Move the arm code here and federate it.** Everything under `cell/` in Ki.CL is business logic with no React in it: protocol, model, grid, controller, station, hub. It moves here and is served as a Module Federation remote named `arm`, the same way Ki.CL-back serves its GraphQL client as the `api` remote. Ki.CL keeps the floor (the React scene and panel) and imports the hub from `arm/hub`. The one thing to prove first is workers: the hub and each controller run in workers, and a worker script must load same-origin, so Ki.CL proxies the remote under its own origin as it already does for `/client`.
3. **GCP.** One `g2-standard-8` with an L4, no public IP, Isaac Sim and Isaac ROS containers, reached over an IAP tunnel. `make gcp.up`, `gcp.down`, `gcp.tunnel`. Tailscale on the VM for the Isaac Sim viewport, since WebRTC needs UDP and IAP is TCP only.
4. **Bridge, C++.** An `rclcpp` node with a WebSocket server, speaking this schema. Each `move` becomes a cuMotion goal through MoveIt, `pick` and `place` drive the gripper, `gate` and `hold` pause the trajectory, `stop` is the controller manager's emergency stop. `/joint_states` comes back as `Telemetry`. `cell/controller/run.ts` in Ki.CL is the spec for its behaviour.
5. **Sim content.** The arm as a URDF from the link lengths in `cell/model/constants.ts`, the hex floor and belts as USD, and `Scene` spawning cases and obstacles so the panel's obstacle editor still works against the sim.
6. **Perception.** Isaac Sim cameras through Isaac ROS, FoundationPose for case poses, nvblox for the obstacle map cuMotion plans around. Detected obstacles come back as boxes so the floor draws what the arm saw.
7. **Later.** A real arm behind the same bridge, and an Isaac Lab policy proposing placements that the station's stability check still has the last word on.
