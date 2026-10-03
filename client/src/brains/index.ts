import type { Attach, Commands, Sensors } from 'arm/frames';

import { cabinet } from './cabinet';
import { handovers } from './handover';
import { jitter } from './jitter';
import { link, type Status } from './link';

/*
 * Where each robot's brain is: the classic one in the cabinet, or physical AI
 * across the link. The floor sends every frame here and takes back the
 * commands due each tick, without knowing which side answered. Answers from
 * the side a robot has just left are ignored, and a robot changing sides is
 * handed over (./handover): it holds still until its new brain carries on
 * from where the old one left it.
 */

type Mode = 'classic' | 'physical';

type Options = {
  /** The bridge's path, such as `/arm/link`; without one there is no physical AI. */
  path?: string;
  onStatus: (status: Status) => void;
};

const brains = ({ onStatus, path }: Options) => {
  const robots = new Map<string, { attach: Attach; mode: Mode }>();
  const inbox: Commands[] = [];
  const buffer = jitter();
  const handing = handovers();
  let now = 0;

  const from = (mode: Mode) => (commands: Commands[]) =>
    commands.forEach((command) => {
      if (robots.get(command.id)?.mode !== mode) {
        return;
      }

      if (mode === 'classic') {
        inbox.push(command);
      } else {
        buffer.push([command], now);
      }
    });

  const sides = {
    classic: cabinet(from('classic')),
    physical: path ? link(path, from('physical'), onStatus) : null,
  };

  return {
    attach: (attach: Attach) => {
      robots.set(attach.id, { attach, mode: 'classic' });
      sides.classic.attach(attach);
    },
    /** Moves robots to one side: those in `ids`, or every one. Each is handed over from its last frame. */
    use: (mode: Mode, ids?: string[]) => {
      const to = sides[mode];

      if (!to) {
        return;
      }

      robots.forEach((robot, id) => {
        if (robot.mode !== mode && (!ids || ids.includes(id))) {
          sides[robot.mode]?.detach(id);
          to.attach({ ...robot.attach, handover: handing.begin(id) });
          robot.mode = mode;
        }
      });
    },
    send: (frames: Sensors[], tick: number) => {
      now = tick;
      handing.see(frames);
      sides.classic.send(frames);
      sides.physical?.send(frames);
    },
    /** Every command due by tick `now`, oldest first, with holds for robots mid-handover. */
    take: (tick: number) =>
      handing.guard([...inbox.splice(0), ...buffer.take(tick)], tick),
    counts: () => ({ ...buffer.counts(), ...handing.counts() }),
    close: () => {
      sides.classic.close();
      sides.physical?.close();
    },
  };
};

export { classic, type Brain } from './classic';
export { handovers } from './handover';
export { brains, type Mode, type Status };
