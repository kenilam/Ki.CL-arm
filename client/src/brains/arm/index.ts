import type { ArmCommands, ArmSensors, Handover } from 'arm/frames';
import { JOINTS, forward, type Pose, type Target } from 'arm/robot';

import { move, sample, type Move } from './motion';
import { overPallet } from './placement';
import { plan, type Step } from './plan';

/*
 * The classic arm brain. It reads a sensor frame, works through its current
 * plan one step at a time, and answers with joint targets and the vacuum.
 * Everything it needs to start again is in the frame, so a fresh brain picks
 * up mid-move, holding a case or not, without being told what came before.
 */

/** How long to wait for the pad to seal or let go before giving up on the job. */
const PATIENCE = 1.5;

/** How near each joint must be to its target, in radians, for a move to be done. */
const SETTLED = 0.002;

/** The most a move waits for its joints to get there, in seconds, before it carries on. */
const SETTLING = 1;

/** Seconds between looks for a new job while idle. */
const IDLE = 0.5;

type State = {
  steps: Step[];
  /** Where the last move ended; the next one starts here. */
  from: Target | null;
  move: Move | null;
  elapsed: number;
  waited: number;
  vacuum: boolean;
  target: Pose | null;
  time: number | null;
  /** Seconds until the next look for a job. */
  rest: number;
};

const arm = (id: string, handover?: Handover) => {
  const state: State = {
    steps: [],
    from: null,
    move: null,
    elapsed: 0,
    waited: 0,
    vacuum: false,
    target: handover ? { ...handover.position } : null,
    time: null,
    rest: 0,
  };

  // Handed over: hold the vacuum as the last brain left it until the plan says otherwise.
  state.vacuum = handover?.vacuum ?? false;

  const next = (sensors: ArmSensors) => {
    state.steps = plan(sensors) ?? [];
    state.from = forward(sensors.position);
    state.move = null;
  };

  /** Advances the head of the plan by `dt`; true when it is done. */
  const run = (step: Step, sensors: ArmSensors, dt: number) => {
    if (step.kind === 'release') {
      const { at } = forward(sensors.position);

      if (!overPallet(sensors.vision, at.x, at.z)) {
        // The pallet has gone, taken away since the plan was made: carry the case somewhere else.
        state.steps = [];
        state.from = forward(sensors.position);

        return false;
      }
    }

    if (step.kind === 'move') {
      state.move ??= state.from ? move(state.from, step.to) : null;

      if (!state.move) {
        // Out of reach from here: drop the plan and think again.
        state.steps = [];

        return false;
      }

      state.elapsed += dt;
      state.target = sample(state.move, state.elapsed) ?? state.target;

      if (state.elapsed < state.move.duration) {
        return false;
      }

      // The drives trail the targets by a tick or so: wait until the joints are there, so a grip or a drop happens where it was planned.
      const settled = JOINTS.every(
        ({ name }) =>
          Math.abs(sensors.position[name] - (state.target?.[name] ?? 0)) <
          SETTLED
      );

      if (!settled && state.elapsed < state.move.duration + SETTLING) {
        return false;
      }

      state.from = step.to;
      state.move = null;
      state.elapsed = 0;

      return true;
    }

    state.vacuum = step.kind === 'grip';
    state.waited += dt;

    const settled = sensors.gripper.contact === state.vacuum;

    if (settled || state.waited > PATIENCE) {
      state.waited = 0;

      if (!settled) {
        state.steps = [];
        state.vacuum = sensors.gripper.contact;
      }

      return settled;
    }

    return false;
  };

  const step = (sensors: ArmSensors): ArmCommands => {
    if (state.time === null && !handover) {
      // Taking over without a handover: hold the joints and the vacuum exactly as found.
      state.target = { ...sensors.position };
      state.vacuum = sensors.gripper.vacuum;
    }

    const dt = state.time === null ? 0 : sensors.time - state.time;

    state.time = sensors.time;
    state.rest -= dt;

    // Someone is in the cell: hold still where we are, gripper as it is.
    if (!sensors.intrusion) {
      if (!state.steps.length && state.rest <= 0) {
        next(sensors);
        state.rest = IDLE;
      }

      const head = state.steps[0];

      if (head && run(head, sensors, dt)) {
        state.steps.shift();
      }
    }

    return {
      id,
      tick: sensors.tick,
      target: state.target ?? sensors.position,
      vacuum: state.vacuum,
    };
  };

  return { step };
};

export { arm };
