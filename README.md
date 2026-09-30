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

## Plan

1. **Wire.** Schema, codegen, remote link, reference bridge. Done.
2. **Federate the arm code.** Done: `client/` is the `arm` remote, Ki.CL keeps the floor page and everything only a page needs. Workers load through Ki.CL's `/arm` proxy.
3. **GCP.** One `g2-standard-8` with an L4, no public IP, Isaac Sim and Isaac ROS containers, reached over an IAP tunnel. `make gcp.up`, `gcp.down`, `gcp.tunnel`. Tailscale on the VM for the Isaac Sim viewport, since WebRTC needs UDP and IAP is TCP only.
4. **Bridge, C++.** An `rclcpp` node with a WebSocket server, speaking this schema. Each `move` becomes a cuMotion goal through MoveIt, `pick` and `place` drive the gripper, `gate` and `hold` pause the trajectory, `stop` is the controller manager's emergency stop. `/joint_states` comes back as `Telemetry`. `client/src/controller/run.ts` is the spec for its behaviour.
5. **Sim content.** The arm as a URDF from the link lengths in `client/src/model/constants.ts`, the hex floor and belts as USD, and `Scene` spawning cases and obstacles so the panel's obstacle editor still works against the sim.
6. **Perception.** Isaac Sim cameras through Isaac ROS, FoundationPose for case poses, nvblox for the obstacle map cuMotion plans around. Detected obstacles come back as boxes so the floor draws what the arm saw.
7. **Later.** A real arm behind the same bridge, and an Isaac Lab policy proposing placements that the station's stability check still has the last word on.
