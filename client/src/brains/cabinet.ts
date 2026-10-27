import type { Attach, Commands, Sensors, ToBrains } from 'arm/frames';

/*
 * The classic brains, spread over a few workers. Robots are dealt to workers
 * in turn, so a floor of fifty arms costs a handful of threads, not fifty.
 * The floor sees one bus: frames in, commands out.
 */

const size = () =>
  Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

const cabinet = (onCommands: (commands: Commands[]) => void) => {
  const workers = Array.from(
    { length: size() },
    () =>
      new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      })
  );
  const owner = new Map<string, Worker>();
  let dealt = 0;

  workers.forEach((worker) => {
    worker.onmessage = ({ data }: MessageEvent<Commands[]>) => onCommands(data);
  });

  const post = (worker: Worker, message: ToBrains) =>
    worker.postMessage(message);

  return {
    attach: (attach: Attach) => {
      const worker = workers[dealt++ % workers.length];

      owner.set(attach.id, worker);
      post(worker, attach);
    },
    detach: (id: string) => {
      const worker = owner.get(id);

      if (worker) {
        post(worker, { type: 'detach', id });
        owner.delete(id);
      }
    },
    send: (frames: Sensors[]) => {
      const batches = new Map<Worker, Sensors[]>();

      frames.forEach((frame) => {
        const worker = owner.get(frame.id);

        if (worker) {
          batches.set(worker, [...(batches.get(worker) ?? []), frame]);
        }
      });
      batches.forEach((batch, worker) =>
        post(worker, { type: 'sensors', frames: batch })
      );
    },
    close: () => workers.forEach((worker) => worker.terminate()),
  };
};

export { cabinet };
