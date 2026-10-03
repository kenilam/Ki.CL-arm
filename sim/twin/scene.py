"""The twin's bodies in Isaac Sim: rigs of an arm from its URDF, the cell it sees, and RMPflow moving it.

One stage holds several rigs, far apart so they never meet, and each page
leases one (./pool.py). Rigs are all built before physics plays and only ever
reset, never added or removed, because changing the scene's articulations
while PhysX runs breaks its views.

Everything a rig is told is in its arm's frame, with the arm's base at the
rig's origin. The floor sends that frame y-up; Isaac is z-up, so (x, y, z)
from the floor is (x, -z, y) here, and a yaw about the floor's y is the same
yaw about Isaac's z.

Who owns a case: the floor, until the twin grips it. A case the floor owns
is kinematic and sits wherever the camera last saw it, belt and all. A case
the twin has gripped follows the pad; once let go it is a dynamic body, and
PhysX settles it on whatever it lands on.
"""

from __future__ import annotations

import math
from pathlib import Path

import isaacsim.core.experimental.utils.stage as stage_utils
import isaacsim.robot_motion.experimental.motion_generation as mg
import numpy as np
import warp as wp
from isaacsim.core.experimental.objects import Cube, DomeLight, GroundPlane
from isaacsim.core.experimental.prims import Articulation, GeomPrim, RigidPrim, XformPrim
from isaacsim.robot_motion.cumotion import CumotionWorldInterface, RmpFlowController, load_cumotion_robot
from pxr import UsdGeom, UsdPhysics

from arm import NAMES, SPEC, Target

HOME = SPEC["home"]

ROBOT = Path(__file__).resolve().parent.parent / "robot"

# Metres between rigs along x: far enough that no arm reaches another's cell.
SPACING = 20.0

# Close enough to a target to take the next step, in metres.
ARRIVED = 0.015
# How near the pad's face must be to a case's top to seal on it, in metres.
SEAL = 0.03
# Seconds before a case the camera no longer sees is taken out of the twin.
FORGET = 1.0
# Where a case out of the cell waits, under the floor, in metres.
PARKED = -50.0


def _z_up(x: float, y: float, z: float) -> list[float]:
    return [x, -z, y]


def _y_up(x: float, y: float, z: float) -> tuple[float, float, float]:
    return x, z, -y


def _yaw_quaternion(yaw: float) -> list[float]:
    return [math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)]


def _quaternion_yaw(w: float, x: float, y: float, z: float) -> float:
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def _name(id: str) -> str:
    return "".join(char if char.isalnum() else "_" for char in id)


def stage() -> None:
    """What every rig shares: the ground and the light."""
    GroundPlane("/World/ground")
    DomeLight("/World/light").set_intensities(1000)


def import_arm() -> str:
    """The arm as USD, converted from the URDF once and kept until the URDF changes."""
    from isaacsim.asset.importer.urdf.impl import URDFImporter, URDFImporterConfig

    urdf = ROBOT / "robot.urdf"
    out = ROBOT.parent / "out"
    stamp = out / f"{urdf.stat().st_mtime_ns}.usd-path"
    if stamp.exists() and Path(stamp.read_text()).exists():
        return stamp.read_text()
    config = URDFImporterConfig()
    config.urdf_path = str(urdf)
    config.usd_path = str(out)
    config.fix_base = True
    config.joint_drive_type = "force"
    config.joint_target_type = "position"
    config.override_joint_stiffness = 1e6
    config.override_joint_damping = 1e5
    usd = URDFImporter(config).import_urdf()
    out.mkdir(parents=True, exist_ok=True)
    stamp.write_text(usd)
    return usd


class Rig:
    def __init__(self, index: int, dt: float) -> None:
        self.dt = dt
        self.t = 0.0
        self.root = f"/World/rig_{index}"
        self.arm_path = f"{self.root}/arm"
        self.origin = np.array([index * SPACING, 0.0, 0.0])
        stage_utils.add_reference_to_stage(usd_path=import_arm(), path=self.arm_path)
        XformPrim(self.arm_path, reset_xform_op_properties=True).set_world_poses(positions=[self.origin.tolist()])
        self.cases: dict[str, dict] = {}
        self.pallets: dict[str, dict] = {}
        self.made = 0
        self.held: str | None = None
        self.target: Target | None = None
        self.robot = None
        self.articulation: Articulation | None = None

    def start(self) -> None:
        """After physics plays: find the arm's joints and pad, and set up RMPflow."""
        self.articulation = Articulation(self.arm_path)
        names = self.articulation.link_names
        self.pad_prim = XformPrim(self.articulation.link_paths[0][names.index("pad")])
        self.indices = [self.articulation.dof_names.index(name) for name in NAMES]
        world = mg.WorldBinding(
            world_interface=CumotionWorldInterface(),
            obstacle_strategy=mg.ObstacleStrategy(),
            tracked_prims=[],
            tracked_collision_api=mg.TrackableApi.PHYSICS_COLLISION,
        )
        world.initialize()
        world.get_world_interface().update_world_to_robot_root_transforms(poses=self.articulation.get_world_poses())
        world.synchronize_transforms()
        self.robot = load_cumotion_robot(directory=ROBOT)
        self.sites = self.robot.robot_description.tool_frame_names()
        self.controller = RmpFlowController(
            cumotion_robot=self.robot,
            cumotion_world_interface=world.get_world_interface(),
            robot_joint_space=self.articulation.dof_names,
            robot_site_space=self.sites,
            tool_frame=self.sites[0],
        )

    def _world(self, x: float, y: float, z: float) -> list[float]:
        """A point in the arm's y-up frame, in Isaac's world."""
        return (np.array(_z_up(x, y, z)) + self.origin).tolist()

    def _path(self, id: str) -> str:
        return f"{self.root}/cell/{_name(id)}"

    # The arm

    def _positions(self) -> np.ndarray:
        return self.articulation.get_dof_positions().numpy().flatten()

    def joints(self) -> dict[str, float]:
        positions = self._positions()
        return {name: float(positions[index]) for name, index in zip(NAMES, self.indices)}

    def _set_joints(self, pose: dict[str, float]) -> None:
        values = wp.array([[pose[name] for name in NAMES]], dtype=wp.float32)
        self.articulation.set_dof_positions(values, dof_indices=self.indices)
        self.articulation.set_dof_position_targets(values, dof_indices=self.indices)

    def pad(self) -> Target:
        positions, orientations = self.pad_prim.get_world_poses()
        x, y, z = (float(value) for value in positions.numpy()[0] - self.origin)
        w, qx, qy, qz = (float(value) for value in orientations.numpy()[0])
        fx, fy, fz = _y_up(x, y, z)
        return Target(fx, fy, fz, _quaternion_yaw(w, qx, qy, qz))

    def _estimated(self) -> mg.RobotState:
        names = self.articulation.dof_names
        return mg.RobotState(
            joints=mg.JointState.from_name(
                robot_joint_space=names,
                positions=(names, self.articulation.get_dof_positions()),
                velocities=(names, self.articulation.get_dof_velocities()),
            )
        )

    def _setpoint(self, target: Target) -> mg.RobotState:
        tool = self.sites[0]
        return mg.RobotState(
            sites=mg.SpatialState.from_name(
                spatial_space=self.sites,
                positions=([tool], wp.array([self._world(target.x, target.y, target.z)], dtype=wp.float32)),
                orientations=([tool], wp.array([_yaw_quaternion(target.yaw)], dtype=wp.float32)),
            )
        )

    def track(self, target: Target) -> None:
        if target != self.target:
            self.target = target
            self.t = 0.0
            self.controller.reset(self._estimated(), self._setpoint(target), t=self.t)
            return
        self.t += self.dt
        desired = self.controller.forward(self._estimated(), self._setpoint(target), self.t)
        if desired is not None and desired.joints.positions is not None:
            names = self.articulation.dof_names
            indices = [int(index) for index in np.asarray(desired.joints.position_indices).flatten()]
            values = desired.joints.positions.numpy().flatten()
            pose = {names[index]: float(value) for index, value in zip(indices, values)}
            # The parallelogram: the wrist turns by the shoulder and elbow together, the other way,
            # so the pad stays level as on the floor, whatever RMPflow makes of the orientation.
            pose["wrist"] = -(pose.get("shoulder", 0.0) + pose.get("elbow", 0.0))
            targets = self._positions()
            for name, index in zip(NAMES, self.indices):
                targets[index] = pose.get(name, targets[index])
            self.articulation.set_dof_position_targets(
                wp.array([[float(targets[index]) for index in self.indices]], dtype=wp.float32),
                dof_indices=self.indices,
            )

    def hold(self) -> None:
        self.target = None
        positions = self._positions()
        self.articulation.set_dof_position_targets(
            wp.array([[positions[index] for index in self.indices]], dtype=wp.float32), dof_indices=self.indices
        )

    def arrived(self, target: Target) -> bool:
        pad = self.pad()
        speed = float(np.abs(self.articulation.get_dof_velocities().numpy()).max())
        return math.dist((pad.x, pad.y, pad.z), (target.x, target.y, target.z)) < ARRIVED and speed < 0.05

    # The gripper

    def holding(self):
        return self.cases[self.held]["seen"] if self.held in self.cases else None

    def grip(self) -> bool:
        if self.held is not None:
            return True
        pad = self.pad()
        for id, case in self.cases.items():
            seen = case["seen"]
            top = case["top"]
            if abs(pad.y - top[1]) < SEAL and math.hypot(pad.x - top[0], pad.z - top[2]) < min(seen.width, seen.depth) / 2:
                self._kinematic(case, True)
                self._collides(case, False)
                case["owned"] = True
                case["offset"] = seen.yaw - pad.yaw
                self.held = id
                return True
        nearest = min(
            self.cases.items(),
            key=lambda item: math.dist((pad.x, pad.y, pad.z), item[1]["top"]),
            default=None,
        )
        if nearest is not None:
            id, case = nearest
            print(
                f"twin: no seal at pad {pad.x:.2f} {pad.y:.2f} {pad.z:.2f}; nearest {id} top "
                f"{case['top'][0]:.2f} {case['top'][1]:.2f} {case['top'][2]:.2f} owned {case['owned']} "
                f"of {len(self.cases)} mirrored",
                flush=True,
            )
        return False

    def release(self) -> None:
        if self.held in self.cases:
            self._collides(self.cases[self.held], True)
            self._kinematic(self.cases[self.held], False)
        self.held = None

    # The cell

    def _kinematic(self, case: dict, on: bool) -> None:
        stage = stage_utils.get_current_stage(backend="usd")
        UsdPhysics.RigidBodyAPI(stage.GetPrimAtPath(case["path"])).CreateKinematicEnabledAttr().Set(on)

    def _collides(self, case: dict, on: bool) -> None:
        # A held case is moved to the pad every step; touching the arm as well, it would shove the arm.
        stage = stage_utils.get_current_stage(backend="usd")
        UsdPhysics.CollisionAPI(stage.GetPrimAtPath(case["path"])).CreateCollisionEnabledAttr().Set(on)

    def _place(self, case: dict, top: tuple[float, float, float], yaw: float) -> None:
        case["top"] = top
        if case["body"] is None:
            # Physics has not taken the new body in yet; it was created where it stands.
            return
        x, y, z = top
        case["body"].set_world_poses(
            positions=[self._world(x, y - case["seen"].height / 2, z)], orientations=[_yaw_quaternion(yaw)]
        )

    def _park(self, path: str, body) -> None:
        """Takes a prim out of the cell without removing it: removing a prim while physics plays breaks PhysX's views."""
        prim = stage_utils.get_current_stage(backend="usd").GetPrimAtPath(path)
        UsdPhysics.CollisionAPI(prim).CreateCollisionEnabledAttr().Set(False)
        UsdGeom.Imageable(prim).MakeInvisible()
        if prim.HasAPI(UsdPhysics.RigidBodyAPI):
            UsdPhysics.RigidBodyAPI(prim).CreateKinematicEnabledAttr().Set(True)
        if body is not None:
            body.set_world_poses(positions=[(self.origin + [0.0, 0.0, PARKED]).tolist()])

    def _new_case(self, item) -> dict:
        self.made += 1
        path = f"{self._path(item.id)}_{self.made}"
        Cube(path, sizes=1.0, scales=[[item.width, item.depth, item.height]],
             positions=[self._world(item.top.x, item.top.y - item.height / 2, item.top.z)],
             orientations=[_yaw_quaternion(item.yaw)])
        GeomPrim(path, apply_collision_apis=True)
        UsdPhysics.RigidBodyAPI.Apply(stage_utils.get_current_stage(backend="usd").GetPrimAtPath(path))
        case = {"path": path, "body": None, "seen": item, "owned": False, "unseen": 0.0}
        self._kinematic(case, True)
        return case

    def _pallet(self, item) -> None:
        pose = {"positions": [self._world(item.top.x, item.top.y - item.height / 2, item.top.z)],
                "orientations": [_yaw_quaternion(item.yaw)]}
        pallet = self.pallets.get(item.id)
        if pallet is None:
            path = self._path(item.id)
            Cube(path, sizes=1.0, scales=[[item.width, item.depth, item.height]], **pose)
            GeomPrim(path, apply_collision_apis=True)
            self.pallets[item.id] = {"path": path, "prim": XformPrim(path), "parked": False}
            return
        if pallet["parked"]:
            prim = stage_utils.get_current_stage(backend="usd").GetPrimAtPath(pallet["path"])
            UsdPhysics.CollisionAPI(prim).CreateCollisionEnabledAttr().Set(True)
            UsdGeom.Imageable(prim).MakeVisible()
            pallet["prim"].set_world_poses(**pose)
            pallet["parked"] = False

    def mirror(self, vision) -> None:
        seen_ids = set()
        for item in vision:
            seen_ids.add(item.id)
            if item.kind == item.KIND_PALLET:
                self._pallet(item)
                continue
            case = self.cases.get(item.id)
            if case is None:
                case = self.cases[item.id] = self._new_case(item)
            case["seen"], case["unseen"] = item, 0.0
            if not case["owned"]:
                self._place(case, (item.top.x, item.top.y, item.top.z), item.yaw)
        for id, case in list(self.cases.items()):
            if id not in seen_ids and id != self.held:
                case["unseen"] += self.dt
                if case["unseen"] > FORGET:
                    self._park(case["path"], case["body"])
                    del self.cases[id]
        for id, pallet in self.pallets.items():
            if id not in seen_ids and not pallet["parked"]:
                self._park(pallet["path"], None)
                pallet["parked"] = True

    def take_over(self, arm, handover=None) -> None:
        """Starts from the handover: its joints moving at its speeds, and the case it holds still held."""
        source = handover if handover is not None else arm
        self._set_joints({name: getattr(source.position, name) for name in NAMES})
        if handover is not None:
            self.articulation.set_dof_velocities(
                wp.array([[getattr(handover.velocity, name) for name in NAMES]], dtype=wp.float32),
                dof_indices=self.indices,
            )
        self.mirror(arm.vision)
        if handover is not None:
            held_id, grip = (handover.held or None) if handover.vacuum else None, handover.grip
        else:
            held = next((item for item in arm.vision if item.held), None)
            held_id, grip = (held.id if arm.gripper.contact and held is not None else None), 0.0
        if held_id in self.cases:
            case = self.cases[held_id]
            case["owned"], case["offset"] = True, grip
            self._collides(case, False)
            self.held = held_id

    def clear(self) -> None:
        for case in self.cases.values():
            self._park(case["path"], case["body"])
        for pallet in self.pallets.values():
            if not pallet["parked"]:
                self._park(pallet["path"], None)
                pallet["parked"] = True
        self.cases, self.held, self.target = {}, None, None

    def reset(self) -> None:
        """Back as built: an empty cell and the arm resting at home, as a new arm for the next page."""
        self.clear()
        self._set_joints(HOME)
        self.articulation.set_dof_velocities(
            wp.array([[0.0] * len(NAMES)], dtype=wp.float32), dof_indices=self.indices
        )

    def step(self) -> None:
        """Takes in bodies created since the last step, and keeps a held case under the pad."""
        for case in self.cases.values():
            if case["body"] is None:
                case["body"] = RigidPrim(case["path"])
        if self.held in self.cases:
            case = self.cases[self.held]
            pad = self.pad()
            self._place(case, (pad.x, pad.y, pad.z), pad.yaw + case.get("offset", 0.0))
