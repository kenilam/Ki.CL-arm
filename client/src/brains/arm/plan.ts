import type { ArmSensors, Seen } from 'arm/frames';
import { forward, type Target } from 'arm/robot';

import { place } from './placement';

/*
 * One pick and place as a list of steps: rise clear, swing over, go down,
 * grip, rise, swing, go down, release, rise. Moves between steps happen at a
 * height clear of everything the camera sees in the cell, which is how the
 * arm keeps off the belt, the pallets and the stacks on them.
 */

type Step =
  { kind: 'move'; to: Target } | { kind: 'grip' } | { kind: 'release' };

/** Space kept over the tallest thing in the cell, in metres. */
const CLEARANCE = 0.25;

const above = ({ at, yaw }: Target, y: number): Target => ({
  at: { ...at, y: Math.max(at.y, y) },
  yaw,
});

/** Height the pad can travel at without hitting anything, with `held` hanging under it. */
const clearOf = (seen: Seen[], held: number) =>
  Math.max(0, ...seen.filter((item) => !item.held).map(({ top }) => top.y)) +
  held +
  CLEARANCE;

/** Where to put `item`, trying each pallet in view until one has room. */
const dropFor = (seen: Seen[], item: Seen) =>
  seen
    .filter(({ kind }) => kind === 'pallet')
    .map((pallet) => place(pallet, seen, item))
    .find((target) => target !== null) ?? null;

const carry = (from: Target, seen: Seen[], item: Seen): Step[] | null => {
  const drop = dropFor(seen, item);

  if (!drop) {
    return null;
  }

  const clear = clearOf(seen, item.height);

  return [
    { kind: 'move', to: above(from, clear) },
    { kind: 'move', to: above(drop, clear) },
    { kind: 'move', to: drop },
    { kind: 'release' },
    { kind: 'move', to: above(drop, clearOf(seen, 0)) },
  ];
};

/**
 * The next job from what the arm senses: finish carrying what is on the pad,
 * or pick the case waiting at the belt. Null when there is nothing to do or
 * nowhere to put it.
 */
const plan = ({ gripper, position, vision }: ArmSensors): Step[] | null => {
  const pad = forward(position);
  const held = vision.find(({ held }) => held);

  if (gripper.contact && held) {
    return carry(pad, vision, held);
  }

  const waiting = vision.find(({ waiting }) => waiting);

  if (!waiting || !dropFor(vision, waiting)) {
    return null;
  }

  const pick: Target = { at: waiting.top, yaw: waiting.yaw };
  const clear = clearOf(vision, 0);
  const rest = carry(pick, vision, waiting);

  return rest
    ? [
        { kind: 'move', to: above(pad, clear) },
        { kind: 'move', to: above(pick, clear) },
        { kind: 'move', to: pick },
        { kind: 'grip' },
        ...rest,
      ]
    : null;
};

export { plan, type Step };
