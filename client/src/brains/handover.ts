import type { Commands, Handover, Sensors } from 'arm/frames';
import { JOINTS, forward, wrap } from 'arm/robot';

/*
 * Moving a robot from one brain to another without dropping a case or
 * jumping a joint. When the switch happens, the robot's last frame becomes a
 * snapshot that goes to the incoming brain. Until that brain answers, the
 * robot holds still at the snapshot with its vacuum as it was. The incoming
 * brain's first command has to continue from the snapshot: no joint further
 * from it than the joint can move in WINDOW seconds, and no letting go of a
 * held case. A first command that fails is dropped and counted, and the
 * robot keeps holding until one passes.
 */

/** Seconds of joint travel the incoming brain's first command may be from the snapshot. */
const WINDOW = 0.25;

const snapshot = (frame: Sensors): Handover => {
  if (frame.robot === 'amr') {
    return {
      position: { base: 0, shoulder: 0, elbow: 0, wrist: 0, flange: 0 },
      velocity: { base: 0, shoulder: 0, elbow: 0, wrist: 0, flange: 0 },
      vacuum: false,
      held: null,
      grip: 0,
      lifted: frame.lifted,
    };
  }

  const held = frame.gripper.contact
    ? (frame.vision.find((item) => item.held) ?? null)
    : null;

  return {
    position: { ...frame.position },
    velocity: { ...frame.velocity },
    vacuum: frame.gripper.vacuum,
    held: held?.id ?? null,
    grip: held ? wrap(held.yaw - forward(frame.position).yaw) : 0,
    lifted: false,
  };
};

/** What the robot is told while it waits for the incoming brain: stay where the snapshot has it. */
const hold = (
  robot: Sensors['robot'],
  id: string,
  tick: number,
  handover: Handover
): Commands =>
  robot === 'arm'
    ? {
        robot,
        id,
        tick,
        target: { ...handover.position },
        vacuum: handover.vacuum,
      }
    : { robot, id, tick, speed: 0, turn: 0, lift: handover.lifted, done: null };

/** Whether a first command carries on from the snapshot. */
const continues = (command: Commands, handover: Handover) => {
  if (command.robot === 'amr') {
    return command.lift === handover.lifted;
  }

  if (handover.vacuum && !command.vacuum) {
    return false;
  }

  return JOINTS.every(
    ({ name, speed }) =>
      Math.abs(command.target[name] - handover.position[name]) <= speed * WINDOW
  );
};

type Pending = { robot: Sensors['robot']; handover: Handover };

const handovers = () => {
  const last = new Map<string, Sensors>();
  const pending = new Map<string, Pending>();
  let violations = 0;

  return {
    /** Keeps each robot's latest frame, the one a snapshot is taken from. */
    see: (frames: Sensors[]) =>
      frames.forEach((frame) => last.set(frame.id, frame)),
    /** Starts a handover for a robot: its snapshot, or none before the robot has reported. */
    begin: (id: string): Handover | undefined => {
      const frame = last.get(id);

      if (!frame) {
        return undefined;
      }

      const handover = snapshot(frame);

      pending.set(id, { robot: frame.robot, handover });

      return handover;
    },
    /**
     * The commands to apply this tick. A robot mid-handover gets a hold
     * until its incoming brain's first command continues from the snapshot.
     */
    guard: (commands: Commands[], tick: number): Commands[] => {
      const passed = commands.filter((command) => {
        const waiting = pending.get(command.id);

        if (!waiting) {
          return true;
        }

        if (continues(command, waiting.handover)) {
          pending.delete(command.id);

          return true;
        }

        violations += 1;

        return false;
      });
      const answered = new Set(passed.map(({ id }) => id));
      const holds = [...pending]
        .filter(([id]) => !answered.has(id))
        .map(([id, { handover, robot }]) => hold(robot, id, tick, handover));

      return [...holds, ...passed];
    },
    /** Robots still waiting on their incoming brain, and first commands refused. */
    counts: () => ({ handing: pending.size, violations }),
  };
};

export { WINDOW, continues, handovers, snapshot };
