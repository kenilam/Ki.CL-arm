import type { Seen } from 'arm/frames';

import { inverse, type Target } from './kinematics';

/*
 * Where the next case goes, worked out from what the camera sees each time,
 * so the brain keeps no tally of its own and a brain taking over mid-pallet
 * carries on where the last one stopped. The pallet's top becomes a height
 * map; the case goes on the lowest flat patch it fits, nearest the pallet's
 * far corner, in either of the two orientations square to the pallet.
 */

/** Height map cell, in metres. */
const CELL = 0.05;

/** Space left between cases on a pallet, in metres, so each sits apart from its neighbours. */
const SEAM = 0.02;

/** The most a patch may vary and still hold a case flat. */
const FLAT = 0.02;

/** Stack no higher than this over the pallet's top. */
const STACK = 1.2;

type Item = Pick<Seen, 'depth' | 'height' | 'width'>;

/** A point in the pallet's own frame: u across its width, w across its depth. */
const local = (pallet: Seen, x: number, z: number) => {
  const dx = x - pallet.top.x;
  const dz = z - pallet.top.z;
  const cos = Math.cos(pallet.yaw);
  const sin = Math.sin(pallet.yaw);

  return { u: dx * cos - dz * sin, w: dx * sin + dz * cos };
};

const world = (pallet: Seen, u: number, w: number) => {
  const cos = Math.cos(pallet.yaw);
  const sin = Math.sin(pallet.yaw);

  return {
    x: pallet.top.x + u * cos + w * sin,
    z: pallet.top.z - u * sin + w * cos,
  };
};

/** Whether a floor point is under a seen item's footprint. */
const under = (item: Seen, x: number, z: number) => {
  const { u, w } = local(item, x, z);

  return Math.abs(u) <= item.width / 2 && Math.abs(w) <= item.depth / 2;
};

/** The cases standing on this pallet. */
const loadOf = (pallet: Seen, seen: Seen[]) =>
  seen.filter(
    (item) =>
      item.kind === 'case' &&
      !item.waiting &&
      item.top.y > pallet.top.y &&
      under(pallet, item.top.x, item.top.z)
  );

const heights = (pallet: Seen, load: Seen[]) => {
  const columns = Math.floor(pallet.width / CELL);
  const rows = Math.floor(pallet.depth / CELL);

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (__, column) => {
      const { x, z } = world(
        pallet,
        (column + 0.5) * CELL - pallet.width / 2,
        (row + 0.5) * CELL - pallet.depth / 2
      );

      return load.reduce(
        (top, item) =>
          under(item, x, z) ? Math.max(top, item.top.y - pallet.top.y) : top,
        0
      );
    })
  );
};

/** The pad target that sets `item` down on `pallet`, or null when the pallet is full. */
const place = (pallet: Seen, seen: Seen[], item: Item): Target | null => {
  const map = heights(pallet, loadOf(pallet, seen));
  let best: { score: number; target: Target } | null = null;

  for (const turn of [0, Math.PI / 2]) {
    const across = Math.ceil(((turn ? item.depth : item.width) + SEAM) / CELL);
    const deep = Math.ceil(((turn ? item.width : item.depth) + SEAM) / CELL);

    for (let row = 0; row + deep <= map.length; row++) {
      for (let column = 0; column + across <= map[0].length; column++) {
        const patch = map
          .slice(row, row + deep)
          .flatMap((line) => line.slice(column, column + across));
        const base = Math.max(...patch);

        if (base - Math.min(...patch) > FLAT || base + item.height > STACK) {
          continue;
        }

        const score = base * 1000 + row * map[0].length + column;

        if (best && score >= best.score) {
          continue;
        }

        const { x, z } = world(
          pallet,
          (column + across / 2) * CELL - pallet.width / 2,
          (row + deep / 2) * CELL - pallet.depth / 2
        );
        const target = {
          at: { x, y: pallet.top.y + base + item.height, z },
          yaw: pallet.yaw + turn,
        };

        if (inverse(target)) {
          best = { score, target };
        }
      }
    }
  }

  return best?.target ?? null;
};

/** Whether a pallet the camera sees is under a floor point, so a case let go there lands on it. */
const overPallet = (seen: Seen[], x: number, z: number) =>
  seen.some((item) => item.kind === 'pallet' && under(item, x, z));

export { loadOf, overPallet, place };
