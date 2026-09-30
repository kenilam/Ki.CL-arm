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

import isaacsim.core.experimental.utils.app as app_utils  # noqa: E402
import isaacsim.core.experimental.utils.stage as stage_utils  # noqa: E402
import omni.graph.core as og  # noqa: E402
import omni.usd  # noqa: E402
import usdrt.Sdf  # noqa: E402
from isaacsim.asset.importer.urdf.impl import URDFImporter, URDFImporterConfig  # noqa: E402
from isaacsim.core.simulation_manager import SimulationManager  # noqa: E402
from pxr import Gf, UsdGeom, UsdPhysics  # noqa: E402

app_utils.enable_extension("isaacsim.ros2.bridge")
simulation_app.update()

# Acceleration drives, so the gains mean the same whatever a link weighs: a
# joint closes on its target like a spring of this natural frequency, a little
# over critically damped. The controller streams a moving target with its own
# speed and acceleration caps, so the drive only has to follow.
FREQUENCY = 30.0
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
    print(f"scene: {arm} at {root}, on /{topic}/joint_states and /{topic}/joint_commands")

simulation_app.update()
SimulationManager.setup_simulation(dt=1.0 / 60.0, device="cpu")
app_utils.play()
simulation_app.update()
print("scene: playing")

frames = 0

while simulation_app.is_running():
    simulation_app.update()
    frames += 1

    if args.test and frames >= 120:
        break

app_utils.stop()
simulation_app.close()
