import { JOINTS, TOOL, type Pose } from './spec';

/*
 * Where the pad is for a pose: the arm's geometry, so the floor uses it to
 * place the pad and the brains use it to plan. Only valid with the pad facing
 * down (shoulder, elbow and wrist pitch summing to zero), which is the only
 * way this arm holds it.
 */

type Vector = { x: number; y: number; z: number };

/** A pad pose in the arm's frame: the centre of its face, and its yaw. */
type Target = { at: Vector; yaw: number };

const [BASE, SHOULDER, ELBOW, WRIST, FLANGE] = JOINTS;

/** Shoulder pivot in the reach plane: out along the reach, and up. */
const PIVOT = {
  u: SHOULDER.origin[0],
  v: BASE.origin[1] + SHOULDER.origin[1],
};
const UPPER = ELBOW.origin[1];
const FORE = WRIST.origin[0];
/** Wrist pivot to the pad's face, straight down. */
const DROP = -FLANGE.origin[1] - TOOL[1];

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

const forward = (pose: Pose): Target => {
  const pitch = pose.shoulder + pose.elbow;
  const u = PIVOT.u - UPPER * Math.sin(pose.shoulder) + FORE * Math.cos(pitch);
  const v =
    PIVOT.v + UPPER * Math.cos(pose.shoulder) + FORE * Math.sin(pitch) - DROP;

  return {
    at: { x: u * Math.cos(pose.base), y: v, z: -u * Math.sin(pose.base) },
    yaw: wrap(pose.base + pose.flange),
  };
};

export { DROP, FORE, PIVOT, UPPER, forward, wrap, type Target, type Vector };
