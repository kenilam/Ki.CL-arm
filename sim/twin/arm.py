"""The arm's geometry for the twin's planner, read from the spec the floor uses.

Pad targets here are in the arm's own frame as the floor sends it: y up, x
where the base points at a base angle of 0. The scene turns them z-up for
Isaac. The pad always faces down, so a target is a point and a yaw.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

SPEC = json.loads((Path(__file__).resolve().parent.parent / "robot" / "spec.json").read_text())
JOINTS = SPEC["joints"]
NAMES = [joint["name"] for joint in JOINTS]

_base, _shoulder, _elbow, _wrist, _flange = JOINTS
PIVOT_U = _shoulder["origin"][0]
PIVOT_V = _base["origin"][1] + _shoulder["origin"][1]
UPPER = _elbow["origin"][1]
FORE = _wrist["origin"][0]
DROP = -_flange["origin"][1] - SPEC["tool"][1]


@dataclass(frozen=True)
class Target:
    x: float
    y: float
    z: float
    yaw: float

    def raised(self, y: float) -> "Target":
        return Target(self.x, max(self.y, y), self.z, self.yaw)


def wrap(angle: float) -> float:
    return math.atan2(math.sin(angle), math.cos(angle))


def forward(pose: dict[str, float]) -> Target:
    """Where the pad's face is for a pose."""
    pitch = pose["shoulder"] + pose["elbow"]
    u = PIVOT_U - UPPER * math.sin(pose["shoulder"]) + FORE * math.cos(pitch)
    v = PIVOT_V + UPPER * math.cos(pose["shoulder"]) + FORE * math.sin(pitch) - DROP
    return Target(u * math.cos(pose["base"]), v, -u * math.sin(pose["base"]), wrap(pose["base"] + pose["flange"]))


def reachable(target: Target) -> bool:
    """Whether the pad can face down at the target within the joints' limits."""
    base = math.atan2(-target.z, target.x)
    du = math.hypot(target.x, target.z) - PIVOT_U
    dv = target.y + DROP - PIVOT_V
    cosine = (du * du + dv * dv - UPPER * UPPER - FORE * FORE) / (2 * UPPER * FORE)
    if not -1 <= cosine <= 1:
        return False
    bend = math.acos(cosine)
    upper = math.atan2(dv, du) + math.atan2(FORE * math.sin(bend), UPPER + FORE * math.cos(bend))
    shoulder = upper - math.pi / 2
    fore = upper - bend
    pose = {"base": base, "shoulder": shoulder, "elbow": fore - shoulder, "wrist": -fore, "flange": wrap(target.yaw - base)}
    return all(joint["min"] - 1e-9 <= pose[joint["name"]] <= joint["max"] + 1e-9 for joint in JOINTS)
