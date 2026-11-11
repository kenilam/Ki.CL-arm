import type { Attach, Commands, Sensors, ToBrains } from 'arm/frames';
import { decode, encode } from './wire';

/*
 * The brains on the far side of the bridge: one WebSocket at `/arm/link`,
 * the same calls as the cabinet. Robots attached while the socket is down are
 * attached when it opens, and again after every reconnect. Sensor frames are
 * dropped while it is down rather than queued: a stale frame is worse than none.
 */

type State = 'connecting' | 'open' | 'closed';

type Status = {
  state: State;
  /** Milliseconds from sending a tick's sensors to its commands coming back. */
  roundTrip: number | null;
};

const RETRY = { first: 500, most: 5000 };

/** Ticks whose send time is kept, for measuring the round trip. */
const SENT = 256;

const toUrl = (path: string) => {
  const url = new URL(path, window.location.href);

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  return url.toString();
};

const link = (
  path: string,
  onCommands: (commands: Commands[]) => void,
  onStatus: (status: Status) => void
) => {
  const attached = new Map<string, Attach>();
  const sent = new Map<number, number>();
  let socket: WebSocket | null = null;
  let wait = RETRY.first;
  let closing = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const post = (message: ToBrains) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(encode(message));
    }
  };

  const open = () => {
    onStatus({ state: 'connecting', roundTrip: null });
    socket = new WebSocket(toUrl(path));
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      wait = RETRY.first;
      attached.forEach(post);
      onStatus({ state: 'open', roundTrip: null });
    };

    socket.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      const commands = decode(new Uint8Array(data));
      const [first] = commands;
      const at = first ? sent.get(first.tick) : undefined;

      if (at !== undefined) {
        onStatus({ state: 'open', roundTrip: performance.now() - at });
      }

      onCommands(commands);
    };

    socket.onclose = () => {
      socket = null;
      onStatus({ state: 'closed', roundTrip: null });

      if (!closing) {
        retry = setTimeout(open, wait);
        wait = Math.min(RETRY.most, wait * 2);
      }
    };
  };

  open();

  return {
    attach: (attach: Attach) => {
      attached.set(attach.id, attach);
      post(attach);
    },
    detach: (id: string) => {
      attached.delete(id);
      post({ type: 'detach', id });
    },
    send: (frames: Sensors[]) => {
      const mine = frames.filter(({ id }) => attached.has(id));
      const [first] = mine;

      if (!first) {
        return;
      }

      sent.set(first.tick, performance.now());
      sent.delete(first.tick - SENT);
      post({ type: 'sensors', frames: mine });
    },
    close: () => {
      closing = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
};

export { link, type State, type Status };
