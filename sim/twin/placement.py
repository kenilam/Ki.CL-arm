"""Where the next case goes, from what the camera sees.

The same rule as the classic brain: the pallet's top becomes a height map,
and the case goes on the lowest flat patch it fits, in either orientation
square to the pallet. Worked out from vision every time, so the twin keeps
no tally and can take over mid-pallet.
"""

from __future__ import annotations

import math

from arm import Target, reachable

CELL = 0.05
# Space left between cases on a pallet, so each sits apart from its neighbours.
SEAM = 0.02
FLAT = 0.02
STACK = 1.2


def _local(pallet, x: float, z: float) -> tuple[float, float]:
    dx, dz = x - pallet.top.x, z - pallet.top.z
    cos, sin = math.cos(pallet.yaw), math.sin(pallet.yaw)
    return dx * cos - dz * sin, dx * sin + dz * cos


def _floor(pallet, u: float, w: float) -> tuple[float, float]:
    cos, sin = math.cos(pallet.yaw), math.sin(pallet.yaw)
    return pallet.top.x + u * cos + w * sin, pallet.top.z - u * sin + w * cos


def under(item, x: float, z: float) -> bool:
    u, w = _local(item, x, z)
    return abs(u) <= item.width / 2 and abs(w) <= item.depth / 2


def load_of(pallet, seen) -> list:
    return [
        item
        for item in seen
        if item.kind == item.KIND_CASE and not item.waiting and not item.held
        and item.top.y > pallet.top.y and under(pallet, item.top.x, item.top.z)
    ]


def _heights(pallet, load) -> list[list[float]]:
    columns, rows = int(pallet.width // CELL), int(pallet.depth // CELL)
    grid = []
    for row in range(rows):
        line = []
        for column in range(columns):
            x, z = _floor(pallet, (column + 0.5) * CELL - pallet.width / 2, (row + 0.5) * CELL - pallet.depth / 2)
            line.append(max([item.top.y - pallet.top.y for item in load if under(item, x, z)], default=0.0))
        grid.append(line)
    return grid


def place(pallet, seen, width: float, depth: float, height: float) -> Target | None:
    """The pad target that sets a case of this size on the pallet, or None when it is full."""
    grid = _heights(pallet, load_of(pallet, seen))
    best = None
    for turn in (0.0, math.pi / 2):
        across = math.ceil(((depth if turn else width) + SEAM) / CELL)
        deep = math.ceil(((width if turn else depth) + SEAM) / CELL)
        for row in range(len(grid) - deep + 1):
            for column in range(len(grid[0]) - across + 1):
                patch = [value for line in grid[row:row + deep] for value in line[column:column + across]]
                base = max(patch)
                if base - min(patch) > FLAT or base + height > STACK:
                    continue
                score = base * 1000 + row * len(grid[0]) + column
                if best and score >= best[0]:
                    continue
                x, z = _floor(pallet, (column + across / 2) * CELL - pallet.width / 2, (row + deep / 2) * CELL - pallet.depth / 2)
                target = Target(x, pallet.top.y + base + height, z, pallet.yaw + turn)
                if reachable(target):
                    best = (score, target)
    return best[1] if best else None
