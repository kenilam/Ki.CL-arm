// Grid
import { PALLET } from '../grid/layout';

/** The top of a pallet's boards, where the first layer stands. */
const DECK = PALLET.size[1];

/** Room kept on a belt round a drop for the last case to move on, in metres. */
const ROOM = 0.6;

/**
 * How far up the belt the arm looks before coming down onto it, in metres:
 * the room, and what the belt carries along in the time it takes to come
 * down and let go, about two and a half seconds.
 */
const LOOKOUT = ROOM + 0.35 * 2.5;

/** Seconds after an obstacle last moved before refused cases are tried again. */
/** How long the station waits after a refused plan before sending again, in seconds: refusals that come from a mismatch do not clear by themselves, so asking every tick only floods the log. */
const RESEND = 1;

/** How far a case may be seen from where the station has it, in metres, before the station moves it there. */
const DRIFT = 0.02;

/** How far a seen case has to be from its place to be said in the log, in metres. */
const STRAYED = 0.1;

/** How close a physical arm's pad must be to the pose it takes over, in metres, before the floor moves on. */
const CLOSE = 0.05;

/** How long the floor waits for a physical arm to get there, in milliseconds, before moving on regardless. */
const ARRIVE = 6000;

/**
 * How much lower a physical arm runs than its model, in metres: gravity and drive lag together. Swings for an arm
 * with a body clear the stacks by this much more, so a case it carries does not clip what it swings over.
 */
const SAG = 0.12;

const SETTLE = 0.4;

export {
  ARRIVE,
  CLOSE,
  DECK,
  DRIFT,
  LOOKOUT,
  RESEND,
  ROOM,
  SAG,
  SETTLE,
  STRAYED,
};
