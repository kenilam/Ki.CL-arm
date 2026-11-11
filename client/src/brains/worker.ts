import type { ToBrains } from 'arm/frames';

import { classic, type Brain } from './classic';

/*
 * A controller cabinet: one worker hosting the classic brains of several
 * robots. Each tick it gets every frame for its robots in one message and
 * answers with every command in one message, off the page's main thread.
 */

const brains = new Map<string, Brain>();

self.onmessage = ({ data }: MessageEvent<ToBrains>) => {
  if (data.type === 'attach') {
    brains.set(data.id, classic(data));
  } else if (data.type === 'detach') {
    brains.delete(data.id);
  } else {
    self.postMessage(
      data.frames.flatMap((frame) => brains.get(frame.id)?.(frame) ?? [])
    );
  }
};
