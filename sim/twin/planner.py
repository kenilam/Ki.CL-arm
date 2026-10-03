"""The twin's task planner: which case, where it goes, and the pad's waypoints.

RMPflow does the moving; this decides where to. One pick and place is a list
of steps: rise clear, swing over, go down, grip, rise, swing, go down,
release, rise. Swings happen at a height clear of everything the camera sees.
"""

from __future__ import annotations

from dataclasses import dataclass

import math

from arm import Target, wrap
from placement import place

CLEARANCE = 0.25


@dataclass(frozen=True)
class Step:
    kind: str  # "move", "grip" or "release"
    to: Target | None = None


def _square(target: Target) -> Target:
    """The same pad target turned half a turn when that keeps the flange nearer the middle of its range.

    A case is a rectangle, so it sits the same either way round; RMPflow turns
    the flange continuously and would otherwise run it into its limit.
    """
    base = math.atan2(-target.z, target.x)
    if abs(wrap(target.yaw - base)) <= math.pi / 2:
        return target
    return Target(target.x, target.y, target.z, wrap(target.yaw + math.pi))


def _clear(seen, held: float) -> float:
    return max([0.0] + [item.top.y for item in seen if not item.held]) + held + CLEARANCE


def _drop(seen, item) -> Target | None:
    for pallet in (one for one in seen if one.kind == one.KIND_PALLET):
        target = place(pallet, seen, item.width, item.depth, item.height)
        if target:
            return target
    return None


def _carry(start: Target, seen, item) -> list[Step] | None:
    drop = _drop(seen, item)
    if not drop:
        return None
    drop = _square(drop)
    clear = _clear(seen, item.height)
    return [
        Step("move", start.raised(clear)),
        Step("move", drop.raised(clear)),
        Step("move", drop),
        Step("release"),
        Step("move", drop.raised(_clear(seen, 0))),
    ]


def plan(vision, pad: Target, holding=None) -> list[Step] | None:
    """The next job, or None when there is nothing to do or nowhere to put it.

    `pad` and `holding` are the twin's own truth: where its pad is, and the
    case sealed on it, if any. `vision` is what the floor's camera sees.
    """
    if holding is not None:
        return _carry(pad, vision, holding)
    waiting = next((item for item in vision if item.waiting), None)
    if not waiting:
        return None
    pick = _square(Target(waiting.top.x, waiting.top.y, waiting.top.z, waiting.yaw))
    rest = _carry(pick, vision, waiting)
    if not rest:
        return None
    clear = _clear(vision, 0)
    return [Step("move", pad.raised(clear)), Step("move", pick.raised(clear)), Step("move", pick), Step("grip"), *rest]
