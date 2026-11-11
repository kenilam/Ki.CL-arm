/*
 * The palletizing arm as hardware: its joints in chain order, each placed in
 * its parent's frame, the way a URDF would describe it. The floor builds its
 * scene graph from this and the brains plan with it, so both agree on where
 * every link is. Metres and radians; y is up, and at zero every joint's arm
 * reaches along +x. The base joint's origin is in the cell's frame, on a
 * 0.3 m pedestal.
 */

type Axis = 'y' | 'z';

type Joint = {
  name: string;
  /** Offset from the parent joint, in the parent's frame. */
  origin: readonly [number, number, number];
  axis: Axis;
  min: number;
  max: number;
  /** Top speed, in radians a second. */
  speed: number;
};

const JOINTS = [
  {
    name: 'base',
    origin: [0, 0.3, 0],
    axis: 'y',
    min: -Math.PI,
    max: Math.PI,
    speed: 2,
  },
  {
    name: 'shoulder',
    origin: [0.2, 0.8, 0],
    axis: 'z',
    min: -1.4,
    max: 0.7,
    speed: 1.6,
  },
  {
    name: 'elbow',
    origin: [0, 1.25, 0],
    axis: 'z',
    min: -1.2,
    max: 1.4,
    speed: 1.6,
  },
  {
    name: 'wrist',
    origin: [1.35, 0, 0],
    axis: 'z',
    min: -2.6,
    max: 2.6,
    speed: 3,
  },
  {
    name: 'flange',
    origin: [0, -0.25, 0],
    axis: 'y',
    min: -Math.PI,
    max: Math.PI,
    speed: 4,
  },
] as const satisfies readonly Joint[];

type JointName = (typeof JOINTS)[number]['name'];

/** One angle per joint, in chain order. */
type Pose = Record<JointName, number>;

/** From the flange to the face of the vacuum pad. */
const TOOL = [0, -0.2, 0] as const;

/** The pad's footprint, in metres: the largest case face it can hold. */
const PAD = { width: 0.6, depth: 0.4 } as const;

/** The heaviest case the arm lifts, in kilograms. */
const PAYLOAD = 50;

/** Folded over its base, clear of a full pallet. */
const HOME: Pose = {
  base: 0,
  shoulder: 0.3,
  elbow: 0.6,
  wrist: -0.9,
  flange: 0,
};

export {
  HOME,
  JOINTS,
  PAD,
  PAYLOAD,
  TOOL,
  type Axis,
  type Joint,
  type JointName,
  type Pose,
};
