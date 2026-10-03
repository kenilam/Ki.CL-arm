import type { Commands } from 'arm/frames';

/*
 * Commands from across the link arrive unevenly: two in one frame, then none
 * for three. The buffer holds each robot's commands by tick and releases them
 * some ticks behind the floor's clock, so they land on a steady beat. How
 * many ticks follows the link: just past how late nine in ten commands have
 * lately arrived, so a slow link (an IAP tunnel, say) gets a longer hold
 * rather than a stream of late commands. A command that turns up after its
 * slot is counted as late and applies once the longer hold makes it due; one
 * older than what was last released is dropped.
 */

/** The least hold, in ticks: 40 ms at 50 ticks a second, and where the buffer starts. */
const DELAY = 2;

/** The most hold, in ticks: half a second. Past that, a steady beat is not worth the lag. */
const LONGEST = 25;

/** Arrivals remembered for sizing the hold. */
const SAMPLES = 100;

/** Commands kept per robot; more than this means the floor stalled. */
const DEPTH = 16;

const jitter = () => {
  const held = new Map<string, Commands[]>();
  const released = new Map<string, number>();
  const lags: number[] = [];
  let delay = DELAY;
  let late = 0;
  let dropped = 0;

  /** Sets the hold just past the ninetieth-percentile arrival. */
  const fit = (lag: number) => {
    lags.push(lag);

    if (lags.length > SAMPLES) {
      lags.shift();
    }

    const sorted = [...lags].sort((a, b) => a - b);
    const slow = sorted[Math.floor(sorted.length * 0.9)] ?? 0;

    delay = Math.max(DELAY, Math.min(LONGEST, Math.ceil(slow) + 1));
  };

  return {
    push: (commands: Commands[], now: number) =>
      commands.forEach((command) => {
        if (command.tick <= (released.get(command.id) ?? -1)) {
          dropped += 1;

          return;
        }

        if (command.tick + delay < now) {
          late += 1;
        }

        fit(now - command.tick);

        const queue = [...(held.get(command.id) ?? []), command]
          .sort((a, b) => a.tick - b.tick)
          .slice(-DEPTH);

        held.set(command.id, queue);
      }),
    /** The newest command per robot that is due by tick `now`. */
    take: (now: number) =>
      [...held].flatMap(([id, queue]) => {
        const due = queue.filter(({ tick }) => tick + delay <= now);
        const last = due.at(-1);

        if (!last) {
          return [];
        }

        held.set(id, queue.slice(due.length));
        released.set(id, last.tick);

        return [last];
      }),
    /** Late and dropped commands, and the hold now in ticks. */
    counts: () => ({ late, dropped, delay }),
  };
};

export { DELAY, jitter };
