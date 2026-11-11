import type { AmrCommands, AmrSensors, Attach } from 'arm/frames';
import { fromPoint, toPoint, type Point } from 'arm/grid';
import { wrap } from 'arm/robot';

import { route } from './route';

/*
 * The classic AMR brain. Given a task, it plans a hex route round the
 * floor's fixed obstacles, steers along it hex by hex, turns to the task's
 * facing, then raises or lowers its deck. It stops dead for a person ahead,
 * and carries on when they have gone.
 */

const SPEED = 1.2;
const TURN = 1.6;
/** Close enough to a waypoint to take the next. */
const ARRIVED = 0.08;
/** Stop when a person is nearer than this ahead. */
const STOP = 1.6;

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

type Config = Extract<Attach, { robot: 'amr' }>['config'];

const amr = (id: string, { blocked }: Config) => {
  const closed = new Set(blocked);
  let task: string | null = null;
  /** Waypoints still ahead; null when there is no way there. */
  let path: Point[] | null = null;
  let done: string | null = null;

  const command = (
    sensors: AmrSensors,
    speed: number,
    turn: number,
    lift = sensors.lifted
  ): AmrCommands => ({ id, tick: sensors.tick, speed, turn, lift, done });

  const step = (sensors: AmrSensors): AmrCommands => {
    const { heading, position, proximity } = sensors;
    const job = sensors.task;

    if (!job) {
      return command(sensors, 0, 0);
    }

    if (job.id !== task) {
      task = job.id;
      done = null;
      path =
        route(fromPoint(position), job.to, closed)
          ?.slice(1)
          .map((hex) => toPoint(hex)) ?? null;
    }

    if (!path || proximity < STOP) {
      return command(sensors, 0, 0);
    }

    const [next] = path;

    if (next) {
      const dx = next.x - position.x;
      const dz = next.z - position.z;

      if (Math.hypot(dx, dz) < ARRIVED) {
        path.shift();

        return command(sensors, 0, 0);
      }

      const error = wrap(Math.atan2(dx, dz) - heading);
      const speed = Math.abs(error) > 0.5 ? 0 : SPEED * Math.cos(error);

      return command(
        sensors,
        Math.min(speed, Math.hypot(dx, dz) * 2),
        clamp(error * 3, TURN)
      );
    }

    const error = wrap(job.facing - heading);

    if (Math.abs(error) > 0.02) {
      return command(sensors, 0, clamp(error * 3, TURN));
    }

    if (sensors.lifted === job.lift) {
      done = job.id;
    }

    return command(sensors, 0, 0, job.lift);
  };

  return { step };
};

export { amr, type Config };
