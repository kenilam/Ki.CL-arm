"""The cell in Isaac Sim: our arm, once per id, each with its joint states going
out and its joint commands coming in over ROS 2.

The arm is sim/arm.urdf, whose joints are the controller's own by name and
sign. For arm id `arm-a` the topics are `/arm_a/joint_states` and
`/arm_a/joint_commands`, both sensor_msgs/JointState; the bridge publishes the
joint targets its controller computed and reads back what the physics did.
One `/clock` for the lot.

    ./python.sh /arm/sim/scene.py --arms arm-a,arm-b
    ./python.sh /arm/sim/scene.py --test      # a few frames, then out
"""

import argparse
import os
import sys

from isaacsim import SimulationApp

parser = argparse.ArgumentParser(description="Our arm in Isaac Sim, on ROS 2.")
parser.add_argument("--arms", default="arm-a", help="Arm ids, comma separated, as the hub names them.")
parser.add_argument("--urdf", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "arm.urdf"))
parser.add_argument("--out", default="/arm/sim/usd", help="Where the converted USD is written.")
parser.add_argument("--spacing", type=float, default=4.0, help="Metres between arms, along the stage's Y.")
parser.add_argument("--test", action="store_true", help="Run a few frames and exit.")
args, _ = parser.parse_known_args()

simulation_app = SimulationApp({"headless": True})

import omni.kit.app  # noqa: E402

extensions = omni.kit.app.get_app().get_extension_manager()
for name in ("omni.scene.optimizer.core", "isaacsim.robot.schema"):
    extensions.set_extension_enabled_immediate(name, True)

import json  # noqa: E402

import isaacsim.core.experimental.utils.app as app_utils  # noqa: E402
import isaacsim.core.experimental.utils.stage as stage_utils  # noqa: E402
import omni.graph.core as og  # noqa: E402
import omni.usd  # noqa: E402
import usdrt.Sdf  # noqa: E402
from isaacsim.asset.importer.urdf.impl import URDFImporter, URDFImporterConfig  # noqa: E402
from isaacsim.core.simulation_manager import SimulationManager  # noqa: E402
from omni.physx.scripts import physicsUtils  # noqa: E402
from pxr import Gf, Sdf, UsdGeom, UsdPhysics  # noqa: E402

app_utils.enable_extension("isaacsim.ros2.bridge")
simulation_app.update()

import rclpy  # noqa: E402  (the bridge extension's own ROS 2)
from std_msgs.msg import Bool, String  # noqa: E402

# Acceleration drives, so the gains mean the same whatever a link weighs: a
# joint closes on its target like a spring of this natural frequency, a little
# over critically damped. The controller streams a moving target with its own
# speed and acceleration caps, so the drive only has to follow. Stiff enough
# that gravity sag stays inside the controller's FOLLOWED tolerance.
FREQUENCY = 50.0
CASE_MASS = 2.0
STIFFNESS = FREQUENCY**2
DAMPING = 2.2 * FREQUENCY

config = URDFImporterConfig()
config.urdf_path = args.urdf
config.usd_path = args.out
config.fix_base = True
config.joint_drive_type = "acceleration"
config.joint_target_type = "position"
config.override_joint_stiffness = STIFFNESS
config.override_joint_damping = DAMPING

usd = URDFImporter(config).import_urdf()

if not usd:
    print(f"scene: could not import {args.urdf}", file=sys.stderr)
    simulation_app.close()
    sys.exit(1)

print(f"scene: arm at {usd}")
stage_utils.set_stage_units(meters_per_unit=1.0)
stage = omni.usd.get_context().get_stage()
# A floor, so a case that misses its pallet lands instead of falling for ever.
physicsUtils.add_ground_plane(stage, "/World/ground", "Z", 50.0, Gf.Vec3f(0.0), Gf.Vec3f(0.5))


def articulation(under: str) -> str:
    """The prim under `under` the physics treats as the arm's root."""
    for prim in stage.Traverse():
        path = str(prim.GetPath())

        if path.startswith(under) and prim.HasAPI(UsdPhysics.ArticulationRootAPI):
            return path

    return under


def wire(topic: str, root: str, clock: bool) -> None:
    """Joint states out and joint commands in for one arm, on its own topics."""
    nodes = [
        ("OnPlaybackTick", "omni.graph.action.OnPlaybackTick"),
        ("ReadJointState", "isaacsim.sensors.physics.IsaacReadJointState"),
        ("Context", "isaacsim.ros2.bridge.ROS2Context"),
        ("PublishJointState", "isaacsim.ros2.bridge.ROS2PublishJointState"),
        ("SubscribeJointState", "isaacsim.ros2.bridge.ROS2SubscribeJointState"),
        ("ArticulationController", "isaacsim.core.nodes.IsaacArticulationController"),
    ]
    connections = [
        ("OnPlaybackTick.outputs:tick", "ReadJointState.inputs:execIn"),
        ("ReadJointState.outputs:execOut", "PublishJointState.inputs:execIn"),
        ("ReadJointState.outputs:jointNames", "PublishJointState.inputs:jointNames"),
        ("ReadJointState.outputs:jointPositions", "PublishJointState.inputs:jointPositions"),
        ("ReadJointState.outputs:jointVelocities", "PublishJointState.inputs:jointVelocities"),
        ("ReadJointState.outputs:jointEfforts", "PublishJointState.inputs:jointEfforts"),
        ("ReadJointState.outputs:jointDofTypes", "PublishJointState.inputs:jointDofTypes"),
        ("ReadJointState.outputs:stageMetersPerUnit", "PublishJointState.inputs:stageMetersPerUnit"),
        ("ReadJointState.outputs:sensorTime", "PublishJointState.inputs:sensorTime"),
        ("OnPlaybackTick.outputs:tick", "SubscribeJointState.inputs:execIn"),
        ("OnPlaybackTick.outputs:tick", "ArticulationController.inputs:execIn"),
        ("Context.outputs:context", "PublishJointState.inputs:context"),
        ("Context.outputs:context", "SubscribeJointState.inputs:context"),
        ("SubscribeJointState.outputs:jointNames", "ArticulationController.inputs:jointNames"),
        ("SubscribeJointState.outputs:positionCommand", "ArticulationController.inputs:positionCommand"),
        ("SubscribeJointState.outputs:velocityCommand", "ArticulationController.inputs:velocityCommand"),
        ("SubscribeJointState.outputs:effortCommand", "ArticulationController.inputs:effortCommand"),
    ]
    values = [
        ("ArticulationController.inputs:robotPath", root),
        ("ReadJointState.inputs:prim", [usdrt.Sdf.Path(root)]),
        ("PublishJointState.inputs:topicName", f"{topic}/joint_states"),
        ("SubscribeJointState.inputs:topicName", f"{topic}/joint_commands"),
    ]

    if clock:
        nodes += [
            ("ReadSimTime", "isaacsim.core.nodes.IsaacReadSimulationTime"),
            ("PublishClock", "isaacsim.ros2.bridge.ROS2PublishClock"),
        ]
        connections += [
            ("OnPlaybackTick.outputs:tick", "PublishClock.inputs:execIn"),
            ("Context.outputs:context", "PublishClock.inputs:context"),
            ("ReadSimTime.outputs:simulationTime", "PublishClock.inputs:timeStamp"),
        ]

    og.Controller.edit(
        {"graph_path": f"/Graphs/{topic}", "evaluator_name": "execution"},
        {
            og.Controller.Keys.CREATE_NODES: nodes,
            og.Controller.Keys.CONNECT: connections,
            og.Controller.Keys.SET_VALUES: values,
        },
    )




def to_sim(point):
    """A point in the controller's frame (x across, y up, z out) in the stage's (X out, Y across, Z up)."""
    x, y, z = point

    return Gf.Vec3d(z, x, y)


class Cell:
    """One arm's cell as physics: pallets as fixed boxes, cases as rigid ones, and a vacuum that takes the case under the pad.

    The hub says what stands where, as boxes in the arm's frame, on `/<arm>/cell`; the vacuum on `/<arm>/vacuum`.
    A case is spawned where the hub first says it is, and never moved by hand after that: the physics own it.
    A case the hub stops listing is removed, unless the vacuum holds it, which is what it looks like from the
    hub's side while a case travels. The vacuum is a fixed joint between the pad and whatever case is under it.
    """

    def __init__(self, node, arm: str, topic: str, base: Gf.Vec3d, under: str):
        self.arm = arm
        self.base = base
        # The importer nests the links its own way; the gripper is the rigid body of that name under the arm.
        self.pad = next(
            (
                str(prim.GetPath())
                for prim in stage.Traverse()
                if str(prim.GetPath()).startswith(under)
                and prim.GetName() == "gripper"
                and prim.HasAPI(UsdPhysics.RigidBodyAPI)
            ),
            None,
        )
        print(f"scene: {arm} pad link {self.pad}")
        self.root = f"/World/{topic}_cell"
        self.cases: dict[str, str] = {}
        self.pallets: dict[str, str] = {}
        self.belts: dict[str, str] = {}
        # Prim names never come round again: a case removed and another spawned must not share a path.
        self.spawned = 0
        self.vacuum = False
        self.held: str | None = None
        self.joint = f"{self.root}/vacuum"
        stage.DefinePrim(self.root, "Xform")
        node.create_subscription(String, f"/{topic}/cell", self.guarded(self.on_cell), 10)
        node.create_subscription(Bool, f"/{topic}/vacuum", self.guarded(self.on_vacuum), 10)

    def guarded(self, handler):
        """A callback whose failure is a log line, not the end of the simulator."""

        def call(message):
            try:
                handler(message)
            except Exception as error:  # noqa: BLE001
                print(f"scene: {self.arm} {handler.__name__} failed: {error!r}")

        return call

    def box(self, path: str, one: dict, rigid: bool, colour) -> str:
        lo, hi = to_sim(one["min"]), to_sim(one["max"])
        size = hi - lo
        prim = UsdGeom.Cube.Define(stage, path)

        prim.GetSizeAttr().Set(1.0)
        prim.GetDisplayColorAttr().Set([colour])
        api = UsdGeom.XformCommonAPI(prim)
        api.SetTranslate(self.base + (lo + hi) / 2)
        api.SetScale(Gf.Vec3f(size[0], size[1], size[2]))
        UsdPhysics.CollisionAPI.Apply(prim.GetPrim())

        if rigid:
            UsdPhysics.RigidBodyAPI.Apply(prim.GetPrim())
            # A light tote: the drives are acceleration drives sized for the arm's own links, and a heavy case
            # hanging off the pad by the vacuum joint is mass they do not see, so the wrist sagged under it.
            UsdPhysics.MassAPI.Apply(prim.GetPrim()).GetMassAttr().Set(CASE_MASS)

        return path

    def name(self, kind: str) -> str:
        self.spawned += 1

        return f"{self.root}/{kind}_{self.spawned}"

    def on_cell(self, message: String) -> None:
        cell = json.loads(message.data)
        wanted = {one["id"]: one for one in cell.get("cases", [])}

        for pallet in cell.get("pallets", []):
            if pallet["id"] not in self.pallets:
                self.pallets[pallet["id"]] = self.box(self.name("pallet"), pallet, rigid=False, colour=Gf.Vec3f(0.55, 0.4, 0.2))

        for belt in cell.get("belts", []):
            if belt["id"] not in self.belts:
                self.belts[belt["id"]] = self.box(self.name("belt"), belt, rigid=False, colour=Gf.Vec3f(0.15, 0.15, 0.15))

        for case_id, one in wanted.items():
            if case_id not in self.cases:
                self.cases[case_id] = self.box(self.name("case"), one, rigid=True, colour=Gf.Vec3f(0.65, 0.85, 0.45))

        for case_id in list(self.cases):
            if case_id not in wanted and case_id != self.held:
                stage.RemovePrim(self.cases.pop(case_id))

        print(f"scene: {self.arm} cell has {len(self.cases)} cases, {len(self.pallets)} pallets, {len(self.belts)} belt pads")

    def under_pad(self) -> str | None:
        """The case whose top is just under the pad's face, if one is."""
        pad = UsdGeom.Xformable(stage.GetPrimAtPath(self.pad)).ComputeLocalToWorldTransform(0)
        # The pad's face is LINK.hand along the gripper's own X, pointing down when the hand does.
        face = pad.Transform(Gf.Vec3d(0.5, 0, 0))
        best = None

        for case_id, path in self.cases.items():
            case = UsdGeom.Xformable(stage.GetPrimAtPath(path))
            at = case.ComputeLocalToWorldTransform(0).ExtractTranslation()
            scale = UsdGeom.XformCommonAPI(case).GetXformVectors(0)[2]
            top = at[2] + scale[2] / 2
            inside = abs(face[0] - at[0]) < scale[0] / 2 + 0.05 and abs(face[1] - at[1]) < scale[1] / 2 + 0.05
            gap = face[2] - top

            if inside and -0.05 < gap < 0.08 and (best is None or gap < best[1]):
                best = (case_id, gap)

        return best[0] if best else None

    def on_vacuum(self, message: Bool) -> None:
        if self.pad is None:
            return

        switched = message.data != self.vacuum
        self.vacuum = message.data

        if message.data and self.held is None:
            case_id = self.under_pad()

            if case_id is None:
                # Said once, as the vacuum comes on: where the pad's face is, and the case nearest under it.
                if switched:
                    pad = UsdGeom.Xformable(stage.GetPrimAtPath(self.pad)).ComputeLocalToWorldTransform(0)
                    face = pad.Transform(Gf.Vec3d(0.5, 0, 0))
                    nearest = min(
                        (
                            (one, UsdGeom.Xformable(stage.GetPrimAtPath(path)).ComputeLocalToWorldTransform(0).ExtractTranslation())
                            for one, path in self.cases.items()
                        ),
                        key=lambda found: (found[1] - face).GetLength(),
                        default=None,
                    )
                    where = f"nearest {nearest[0]} at {tuple(round(v, 3) for v in nearest[1])}" if nearest else "no cases"
                    print(f"scene: {self.arm} vacuum on with nothing under the pad: face {tuple(round(v, 3) for v in face)}, {where}")
                return

            joint = UsdPhysics.FixedJoint.Define(stage, self.joint)
            joint.CreateBody0Rel().SetTargets([Sdf.Path(self.pad)])
            joint.CreateBody1Rel().SetTargets([Sdf.Path(self.cases[case_id])])
            pad = UsdGeom.Xformable(stage.GetPrimAtPath(self.pad)).ComputeLocalToWorldTransform(0)
            case = UsdGeom.Xformable(stage.GetPrimAtPath(self.cases[case_id])).ComputeLocalToWorldTransform(0)
            # Where the case sits in the pad's frame, so the joint holds it exactly where the vacuum found it.
            local = case * pad.GetInverse()
            joint.CreateLocalPos0Attr().Set(Gf.Vec3f(local.ExtractTranslation()))
            joint.CreateLocalRot0Attr().Set(Gf.Quatf(local.ExtractRotationQuat()))
            joint.CreateLocalPos1Attr().Set(Gf.Vec3f(0, 0, 0))
            joint.CreateLocalRot1Attr().Set(Gf.Quatf(1, 0, 0, 0))
            self.held = case_id
            print(f"scene: {self.arm} vacuum takes {case_id}")
        elif not message.data and self.held is not None:
            stage.RemovePrim(self.joint)
            print(f"scene: {self.arm} vacuum lets go of {self.held}")
            self.held = None


rclpy.init()
ros = rclpy.create_node("arm_cells")
cells: list[Cell] = []
arms = [one.strip() for one in args.arms.split(",") if one.strip()]

for index, arm in enumerate(arms):
    # ROS names take no dashes.
    topic = arm.replace("-", "_")
    path = f"/World/{topic}"

    stage_utils.add_reference_to_stage(usd, path)
    UsdGeom.XformCommonAPI(stage.GetPrimAtPath(path)).SetTranslate(Gf.Vec3d(0, index * args.spacing, 0))
    simulation_app.update()

    root = articulation(path)

    wire(topic, root, clock=index == 0)
    cells.append(Cell(ros, arm, topic, Gf.Vec3d(0, index * args.spacing, 0), path))
    print(f"scene: {arm} at {root}, on /{topic}/joint_states and /{topic}/joint_commands, cell on /{topic}/cell")

simulation_app.update()
SimulationManager.setup_simulation(dt=1.0 / 60.0, device="cpu")
app_utils.play()
simulation_app.update()
print("scene: playing")

frames = 0

while simulation_app.is_running():
    rclpy.spin_once(ros, timeout_sec=0)
    simulation_app.update()
    frames += 1

    if args.test and frames >= 120:
        break

app_utils.stop()
rclpy.shutdown()
simulation_app.close()
