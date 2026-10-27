import type { Hex, Point } from 'arm/grid';
import type { Pose, Vector } from 'arm/robot';

/*
 * What crosses between a robot and its brain on each bus tick. The same
 * frames go to the classic brain in a worker and, later, to physical AI over
 * the link, so a brain can be swapped without the robot noticing.
 *
 * Arm frames are in the arm's own frame: origin on the floor under its base,
 * y up, x where the base points at a base angle of 0. AMR frames are in floor
 * coordinates, since an AMR carries a map of the floor.
 */

/** One thing the cell camera sees, as a vision system reports it. */
type Seen = {
  id: string;
  kind: 'case' | 'pallet';
  /** Centre of the item's top face. */
  top: Vector;
  /** Width along the item's own x, depth along its own z. */
  width: number;
  depth: number;
  height: number;
  /** Rotation about y. */
  yaw: number;
  /** For a case: it is at the belt's pick point, waiting. */
  waiting?: boolean;
  /** For a case: it is on this arm's pad. */
  held?: boolean;
};

type ArmSensors = {
  id: string;
  /** Bus tick, so a brain can tell a late frame from a lost one. */
  tick: number;
  /** Seconds since the floor started. */
  time: number;
  /** Joint encoders. */
  position: Pose;
  velocity: Pose;
  gripper: {
    vacuum: boolean;
    /** The pad is sealed on a case. */
    contact: boolean;
    /** Kilograms on the pad. */
    payload: number;
  };
  vision: Seen[];
  /** The safety scanner: someone is inside the cell. */
  intrusion: boolean;
};

type ArmCommands = {
  id: string;
  tick: number;
  /** Joint targets; the drives move towards them at no more than each joint's top speed. */
  target: Pose;
  vacuum: boolean;
};

/** A job from the fleet manager: go to a hex, and lift or lower the deck there. */
type Task = {
  id: string;
  to: Hex;
  /** Facing to arrive at, in radians about y. */
  facing: number;
  lift: boolean;
};

type AmrSensors = {
  id: string;
  tick: number;
  time: number;
  /** Odometry, in floor coordinates. */
  position: Point;
  heading: number;
  /** Deck raised, and whether a pallet is on it. */
  lifted: boolean;
  loaded: boolean;
  /** Distance to the nearest person ahead, in metres; Infinity when clear. */
  proximity: number;
  task: Task | null;
};

type AmrCommands = {
  id: string;
  tick: number;
  /** Forward speed in metres a second, and turn rate in radians a second. */
  speed: number;
  turn: number;
  lift: boolean;
  /** The task this brain has finished, so the fleet manager can hand out the next. */
  done: string | null;
};

type Sensors =
  ({ robot: 'arm' } & ArmSensors) | ({ robot: 'amr' } & AmrSensors);

type Commands =
  ({ robot: 'arm' } & ArmCommands) | ({ robot: 'amr' } & AmrCommands);

/**
 * The robot as the outgoing brain left it, handed to the incoming one. The
 * incoming brain starts from these joints and this grip, and its first
 * command has to continue from them.
 */
type Handover = {
  position: Pose;
  velocity: Pose;
  vacuum: boolean;
  /** The case on the pad, if any. */
  held: string | null;
  /** The held case's yaw less the pad's, so it stays turned the same on the pad. */
  grip: number;
  /** For an AMR: its deck. */
  lifted: boolean;
};

/** Puts a robot on a set of brains, from a handover when it comes from another. An AMR comes with its map: the hexes, as `q,r` keys, it may not drive through. */
type Attach = { type: 'attach'; id: string; handover?: Handover } & (
  | { robot: 'arm' }
  | { robot: 'amr'; config: { blocked: string[] } }
);

/** What the floor sends to its brains, in a worker or across the link. */
type ToBrains =
  | Attach
  | { type: 'detach'; id: string }
  | { type: 'sensors'; frames: Sensors[] };

export type {
  AmrCommands,
  Attach,
  AmrSensors,
  ArmCommands,
  ArmSensors,
  Commands,
  Handover,
  Seen,
  Sensors,
  Task,
  ToBrains,
  Vector,
};
