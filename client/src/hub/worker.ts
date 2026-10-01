// Protocol
import type { Box, Feed } from '../protocol';

// Controller
import { connect } from '../controller/link';
import { dial, resolve, type Wire } from '../controller/remote';

// Grid
import type { Hex } from '../grid/hex';
import type { Layout, Line as Geometry } from '../grid/layout';

// Station
import type { Event } from '../station/events';

// Partials
import type { Capacity, Target } from './board';
import type { Floor } from './floor';
import { type Cell, create, type Hub, type Line, type Riding } from './hub';

/** How often the hub runs its stations, in milliseconds. */
const WAKE = 1000 / 30;

/**
 * What the console sends the hub. `floor` is the whole thing at once: the
 * hub builds from the configuration and is ready to run. The rest change a
 * running floor one piece at a time. A `link` puts the arms on a bridge at
 * that address rather than in workers here, and `link` on its own moves the
 * arms of a running floor there, or back, without starting it over. `scene` is the simulation's
 * side door: the boxes an arm's sensors would meet, which a real arm gets
 * from the world itself.
 */
type Inbound =
  | { type: 'floor'; floor: Floor; link?: string }
  | { type: 'build'; cells: Cell[]; lines: Line[]; link?: string }
  | { type: 'link'; link?: string }
  | { type: 'load'; hex: Hex }
  | { type: 'block'; boxes: Box[]; moved: boolean }
  | { type: 'place'; target: Omit<Target, 'claimed' | 'version'> }
  | { type: 'plan'; id: string; queue?: string[]; to?: Hex }
  | { type: 'remove'; id: string }
  | { type: 'configure'; arm: string; capacity: Capacity }
  | { type: 'ride'; line: string; riders: Riding[] }
  | { type: 'scene'; arm: string; boxes: Box[] };

/**
 * What the hub sends back: each station's layout and the lines on the floor
 * once built, the board as it changes, what rides each line, and every
 * station's events.
 */
type Outbound =
  | {
      type: 'layouts';
      stations: { arm: string; hex: Hex; layout: Layout }[];
      lines: Geometry[];
    }
  | { type: 'board'; targets: Target[] }
  | { type: 'riders'; line: string; riders: Riding[]; running: boolean }
  | { type: 'event'; hex: Hex; arm: string; event: Event };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Inbound>) => void) | null;
  postMessage: (message: Outbound[]) => void;
};

let hub: Hub | null = null;
let wire: Wire | null = null;
let last = 0;
let shown = '';
let loop: ReturnType<typeof setInterval> | null = null;
/** What each line last carried, as the page was told it. */
const rode = new Map<string, string>();
const feeds = new Map<string, Feed>();

/** The board, as far as the page needs to tell it apart from last time. */
const stamp = (targets: Target[]) =>
  targets
    .map(
      ({ id, version, claimed, queue }) =>
        `${id}:${version}:${claimed}:${queue.length}`
    )
    .join('|');

// The hub's own clock: each wake runs the stations for the time gone by.
const wake = () => {
  if (!hub) {
    return;
  }

  const now = performance.now();

  hub.tick((now - last) / 1000);
  last = now;

  const out: Outbound[] = hub
    .drain()
    .map(({ arm, event, hex }) => ({ type: 'event', arm, event, hex }));
  const targets = hub.board.targets();
  const next = stamp(targets);

  if (next !== shown) {
    shown = next;
    out.push({ type: 'board', targets });
  }

  hub.riders.forEach((riders, line) => {
    const running = hub?.running.get(line) ?? false;
    const moving =
      riders.map(({ at, id }) => `${id}@${at.toFixed(3)}`).join() +
      (running ? '>' : '|');

    if (moving !== rode.get(line)) {
      rode.set(line, moving);
      out.push({ type: 'riders', line, riders, running });
    }
  });

  if (out.length) {
    scope.postMessage(out);
  }
};

/** The bridge came back after going away: whatever is behind it now may know nothing, so every station greets its arm again. */
const greet = () => hub?.stations.forEach(({ id }) => hub?.wake(id));

/** A new hub from `cells` and `lines`, its arms in workers here or on the bridge at `link`. */
/**
 * The wire to the bridge at `address`, dialled once and kept: a socket over a tunnel takes seconds to come up,
 * and the switch has to be instant however often it is pressed. Only a different address hangs up the old one.
 */
const wireTo = (address: string) => {
  if (wire?.url !== resolve(address)) {
    wire?.close();
    wire = dial(address, greet);
  }

  return wire;
};

const build = (cells: Cell[], lines: Line[], link?: string) => {
  hub?.close();

  const bridge = link ? wireTo(link) : null;
  // Each arm's controller runs in a worker of its own, as its own box would, unless a bridge has them.
  hub = create({
    cells,
    lines,
    connect: (arm) => {
      const found = bridge ? bridge.link(arm) : connect(arm);

      feeds.set(arm, found.feed);

      return found;
    },
    feed: (arm, boxes, cases, pallets, belts) =>
      feeds.get(arm)?.(boxes, cases, pallets, belts),
  });
  last = performance.now();
  shown = '';
  rode.clear();
  loop ??= setInterval(wake, WAKE);
  scope.postMessage([
    {
      type: 'layouts',
      stations: [...hub.stations.values()].map(({ hex, id, layout }) => ({
        arm: id,
        hex,
        layout,
      })),
      lines: hub.floor,
    },
  ]);
};

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case 'floor':
      build(data.floor.cells, data.floor.lines, data.link);
      // Before the stations load, so each starts knowing what stands in its cell.
      hub?.block(data.floor.obstacles ?? [], false);
      data.floor.cells.forEach(({ hex }) => hub?.load(hex));
      data.floor.pallets.forEach((target) => hub?.place(target));
      Object.entries(data.floor.capacities ?? {}).forEach(([arm, capacity]) =>
        hub?.configure(arm, capacity)
      );

      return;
    case 'build':
      build(data.cells, data.lines, data.link);

      return;
    case 'link': {
      // Off the bridge, the wire stays up and its arms stay held, so the next press is instant.
      const bridge = data.link ? wireTo(data.link) : null;

      hub?.stations.forEach(({ id }) => {
        const found = bridge ? bridge.link(id) : connect(id);

        feeds.set(id, found.feed);
        hub?.relink(id, found);
      });

      return;
    }
    case 'load':
      hub?.load(data.hex);

      return;
    case 'block':
      hub?.block(data.boxes, data.moved);

      return;
    case 'place':
      hub?.place(data.target);

      return;
    case 'plan':
      hub?.plan(data.id, data);

      return;
    case 'remove':
      hub?.remove(data.id);

      return;
    case 'configure':
      hub?.configure(data.arm, data.capacity);

      return;
    case 'ride':
      hub?.ride(data.line, data.riders);

      return;
    case 'scene':
      feeds.get(data.arm)?.(data.boxes);
  }
};

export type { Inbound, Outbound };
