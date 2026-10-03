"""Checks the imported arm against the spec: sets known poses and compares the pad in Isaac with forward()."""

from __future__ import annotations

import sys
import traceback

from isaacsim import SimulationApp

app = SimulationApp({"headless": True})

import omni.kit.app  # noqa: E402

manager = omni.kit.app.get_app().get_extension_manager()
for extension in ("omni.scene.optimizer.core", "isaacsim.robot.schema"):
    manager.set_extension_enabled_immediate(extension, True)

import isaacsim.core.experimental.utils.app as app_utils  # noqa: E402
from isaacsim.core.simulation_manager import SimulationManager  # noqa: E402
from pxr import UsdPhysics  # noqa: E402

import isaacsim.core.experimental.utils.stage as stage_utils  # noqa: E402
from arm import NAMES, forward  # noqa: E402
from scene import Rig, stage  # noqa: E402

POSES = [
    {"base": 0.0, "shoulder": 0.3, "elbow": 0.6, "wrist": -0.9, "flange": 0.0},
    {"base": 1.1, "shoulder": -0.7, "elbow": 0.2, "wrist": 0.5, "flange": 0.4},
    {"base": -0.5, "shoulder": 0.1, "elbow": -0.8, "wrist": 0.7, "flange": -1.3},
]

try:
    SimulationManager.setup_simulation(dt=1 / 60, device="cpu")
    stage()
    scene = Rig(0, 1 / 60)
    app.update()
    app_utils.play()
    app.update()
    scene.start()
    usd = stage_utils.get_current_stage(backend="usd")
    for prim in usd.Traverse():
        if prim.IsA(UsdPhysics.RevoluteJoint) and str(prim.GetPath()).startswith(scene.arm_path):
            joint = UsdPhysics.RevoluteJoint(prim)
            print("joint", prim.GetName(), "axis", joint.GetAxisAttr().Get(),
                  "limits", joint.GetLowerLimitAttr().Get(), joint.GetUpperLimitAttr().Get(),
                  "rot0", joint.GetLocalRot0Attr().Get(), "rot1", joint.GetLocalRot1Attr().Get(), flush=True)
    print("dof names", scene.articulation.dof_names, flush=True)
    for pose in POSES:
        scene._set_joints(pose)
        for _ in range(30):
            app.update()
        pad = scene.pad()
        want = forward(pose)
        print("pose", pose, flush=True)
        print("  joints now", {name: round(value, 3) for name, value in scene.joints().items()}, flush=True)
        print("  isaac pad  %.3f %.3f %.3f yaw %.3f" % (pad.x, pad.y, pad.z, pad.yaw), flush=True)
        print("  spec pad   %.3f %.3f %.3f yaw %.3f" % (want.x, want.y, want.z, want.yaw), flush=True)
except BaseException:
    traceback.print_exc()
    sys.stdout.flush()
finally:
    print("check done", flush=True)
    app.close()
