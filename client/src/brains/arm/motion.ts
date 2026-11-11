import { JOINTS, wrap, type Target } from 'arm/robot';

import { inverse } from './kinematics';

/*
 * A move takes the pad from one target to the next, interpolating round the
 * base rather than in a straight line: angle, radius and height each ease
 * from start to end, so a move at one height stays at that height, and a
 * move straight up or down stays over the same point. Each tick the brain
 * samples the move and solves for the pose there.
 */

type Move = { from: Target; to: Target; duration: number };

/** Top speed of the pad itself, in metres a second. */
const PAD_SPEED = 1.2;

/** The eased curve's top speed over its average, for 3t² - 2t³. */
const PEAK = 1.5;

const MINIMUM = 0.25;

const cylinder = ({ at, yaw }: Target) => ({
  angle: Math.atan2(-at.z, at.x),
  radius: Math.hypot(at.x, at.z),
  y: at.y,
  yaw,
});

const ease = (t: number) => t * t * (3 - 2 * t);

const at = (from: Target, to: Target, t: number): Target => {
  const a = cylinder(from);
  const b = cylinder(to);
  const angle = a.angle + (b.angle - a.angle) * t;
  const radius = a.radius + (b.radius - a.radius) * t;

  return {
    at: {
      x: radius * Math.cos(angle),
      y: a.y + (b.y - a.y) * t,
      z: -radius * Math.sin(angle),
    },
    yaw: a.yaw + wrap(b.yaw - a.yaw) * t,
  };
};

/** Long enough that neither the pad nor any joint passes its top speed. */
const duration = (from: Target, to: Target) => {
  const a = inverse(from);
  const b = inverse(to);

  if (!a || !b) {
    return null;
  }

  const path = Math.hypot(
    to.at.x - from.at.x,
    to.at.y - from.at.y,
    to.at.z - from.at.z
  );
  const joints = JOINTS.map(
    ({ name, speed }) => Math.abs(b[name] - a[name]) / speed
  );

  return Math.max(MINIMUM, PEAK * Math.max(path / PAD_SPEED, ...joints));
};

const move = (from: Target, to: Target): Move | null => {
  const seconds = duration(from, to);

  return seconds === null ? null : { from, to, duration: seconds };
};

/** The pose `elapsed` seconds into a move; past its end, the end pose. */
const sample = ({ duration: total, from, to }: Move, elapsed: number) =>
  inverse(at(from, to, ease(Math.min(1, Math.max(0, elapsed / total)))));

export { move, sample, type Move };
