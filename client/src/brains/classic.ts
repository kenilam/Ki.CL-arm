import type { Attach, Commands, Sensors } from 'arm/frames';

import { amr } from './amr';
import { arm } from './arm';

/** One robot's classic brain: a sensor frame in, its commands out. */
type Brain = (frame: Sensors) => Commands | null;

const classic = (attach: Attach): Brain => {
  if (attach.robot === 'arm') {
    const { step } = arm(attach.id, attach.handover);

    return (frame) =>
      frame.robot === 'arm' ? { robot: 'arm', ...step(frame) } : null;
  }

  const { step } = amr(attach.id, attach.config);

  return (frame) =>
    frame.robot === 'amr' ? { robot: 'amr', ...step(frame) } : null;
};

export { classic, type Brain };
