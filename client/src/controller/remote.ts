// Protocol
import type { Box, Link, Report } from '../protocol';
import { decodeReport, encodeToArm, type ToArm } from '../protocol/wire';

/** How long after the socket drops before it is dialled again, in milliseconds. */
const RETRY = 1000;

/** `address` as a socket URL: a path such as `/arm/link` is taken on this page's own origin, over wss when the page is https. */
const resolve = (address: string) => {
  const url = new URL(address, self.location.href);

  url.protocol =
    url.protocol === 'https:'
      ? 'wss:'
      : url.protocol === 'http:'
        ? 'ws:'
        : url.protocol;

  return url.href;
};

/**
 * One socket to a bridge with arms behind it, and a `Link` on it for each
 * arm. Every frame is one protobuf message; the arm's id in it tells the
 * links apart. While the socket is down, commands queue and only the last
 * scene per arm is kept, and all of it goes out once it is up again.
 */
const dial = (address: string) => {
  const url = resolve(address);
  const handlers = new Map<string, Set<(report: Report) => void>>();
  const commands: Uint8Array[] = [];
  const scenes = new Map<string, Uint8Array>();
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const flush = () => {
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    // Copied: the socket wants a view on a plain ArrayBuffer, and the encoder's type doesn't promise one.
    commands.splice(0).forEach((bytes) => socket?.send(new Uint8Array(bytes)));
    scenes.forEach((bytes) => socket?.send(new Uint8Array(bytes)));
    scenes.clear();
  };

  const open = () => {
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = flush;
    socket.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      try {
        const report = decodeReport(new Uint8Array(data));

        handlers.get(report.arm)?.forEach((handler) => handler(report));
      } catch (error) {
        console.warn(`Dropped a frame from ${url}`, error);
      }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      socket = null;

      if (!closed) {
        retry = setTimeout(open, RETRY);
      }
    };
  };

  const shut = () => {
    closed = true;
    handlers.clear();

    if (retry) {
      clearTimeout(retry);
    }

    socket?.close();
  };

  const send = (message: ToArm) => {
    const bytes = encodeToArm(message);

    if (message.type === 'scene') {
      scenes.set(message.arm, bytes);
    } else {
      commands.push(bytes);
    }

    flush();
  };

  open();

  return {
    url,
    link: (arm: string): Link & { feed: (boxes: Box[]) => void } => {
      const own = new Set<(report: Report) => void>();

      handlers.set(arm, own);

      return {
        arm,
        send,
        feed: (boxes) => send({ type: 'scene', arm, boxes }),
        listen: (handler) => {
          own.add(handler);

          return () => own.delete(handler);
        },
        close: () => {
          own.clear();
          handlers.delete(arm);

          // The last link off the wire takes the socket with it.
          if (!handlers.size) {
            shut();
          }
        },
      };
    },
    close: shut,
  };
};

type Wire = ReturnType<typeof dial>;

export { dial };
export type { Wire };
