import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import { type WebSocket, WebSocketServer } from 'ws';

// Client
import { local } from '../client/src/controller/local';
import { decodeToArm, encodeReport } from '../client/src/protocol/wire';

/*
 * The arm server for development: the federated remote at /arm/*, and the
 * simulated controllers behind the wire at /arm/link. The browser's remote
 * link dials that when there is no bridge on GCP yet, and it is the
 * reference for what that bridge has to do. Every frame is one protobuf
 * message. An arm comes into being on the first message that names it,
 * which is the scene the hub feeds it on load, and every arm goes when the
 * last hub does; a real bridge knows its arms before anyone dials in and
 * keeps them after.
 */

const PORT = Number(process.env.PORT ?? 3200);

/** How often the loop wakes, in milliseconds; each wake runs the ticks owed since the last. */
const WAKE = 4;

/** The most time one wake makes up for, in seconds, so a stalled process doesn't run a backlog. */
const CATCHUP = 0.25;

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../client/dist'
);

const arms = new Map<string, ReturnType<typeof local>>();
const sockets = new Set<WebSocket>();
let last = performance.now();

/** The controller for `id`, booted on first mention. Its reports go to every hub dialled in. */
const arm = (id: string) => {
  let found = arms.get(id);

  if (!found) {
    found = local(id);
    found.listen((report) => {
      const bytes = encodeReport(report);

      sockets.forEach((socket) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(bytes);
        }
      });
    });
    arms.set(id, found);
    console.log(`arm ${id} booted`);
  }

  return found;
};

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(CATCHUP, (now - last) / 1000);

  last = now;
  arms.forEach((one) => one.tick(dt));
}, WAKE);

const app = express();

app.get('/health', (_, response) => {
  response.status(200).json({ status: 'ok' });
});

// CORS for the host's Node side, which pulls the types straight from here rather than through the proxy.
app.use('/arm', cors(), express.static(dist));

const server = createServer(app);
const links = new WebSocketServer({ server, path: '/arm/link' });

links.on('connection', (socket) => {
  sockets.add(socket);
  console.log(`hub connected (${sockets.size})`);

  socket.on('message', (data: Buffer) => {
    try {
      const message = decodeToArm(new Uint8Array(data));

      if (message.type === 'scene') {
        arm(message.arm).feed(message.boxes);
      } else {
        arm(message.arm).send(message);
      }
    } catch (error) {
      console.warn('dropped a frame', error);
    }
  });

  socket.on('close', () => {
    sockets.delete(socket);
    console.log(`hub gone (${sockets.size})`);

    // The simulated world lives in the hub, so with no hub left the arms in it are gone too: the next hub starts them fresh, holding nothing. A real arm keeps its state; that is the bridge's business.
    if (!sockets.size) {
      arms.forEach((one) => one.close());
      arms.clear();
      console.log('arms cleared');
    }
  });
});

server.listen(PORT, () => {
  console.log(`remote on http://localhost:${PORT}/arm/remoteEntry.js`);
  console.log(`arms on ws://localhost:${PORT}/arm/link`);
});
