/*
 * One fine axial hex grid over the whole floor, pointy-top, in metres on the
 * floor plane (x, z). Everything on the floor is located by the hex it is
 * over; arm cells are built from these hexes in ./cell.
 */

type Hex = { q: number; r: number };

type Point = { x: number; z: number };

/** Centre to corner, in metres. Flat to flat is √3 times this. */
const SIZE = 1;

const SQRT3 = Math.sqrt(3);

/** The six neighbours' offsets, counter-clockwise from +q. */
const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const hex = (q: number, r: number): Hex => ({ q, r });

const add = (a: Hex, b: Hex): Hex => hex(a.q + b.q, a.r + b.r);

const subtract = (a: Hex, b: Hex): Hex => hex(a.q - b.q, a.r - b.r);

const equals = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;

/** A stable string for maps and sets. */
const key = ({ q, r }: Hex) => `${q},${r}`;

const distance = (a: Hex, b: Hex) => {
  const { q, r } = subtract(a, b);

  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
};

const neighbours = (of: Hex) =>
  DIRECTIONS.map((direction) => add(of, direction));

/** Every hex within `radius` steps of `centre`, the centre included. */
const range = (centre: Hex, radius: number) => {
  const found: Hex[] = [];

  for (let q = -radius; q <= radius; q++) {
    const from = Math.max(-radius, -q - radius);
    const to = Math.min(radius, -q + radius);

    for (let r = from; r <= to; r++) {
      found.push(add(centre, hex(q, r)));
    }
  }

  return found;
};

const toPoint = ({ q, r }: Hex, size = SIZE): Point => ({
  x: size * SQRT3 * (q + r / 2),
  z: size * 1.5 * r,
});

/** The hex a floor point is over. */
const fromPoint = ({ x, z }: Point, size = SIZE): Hex => {
  const q = ((SQRT3 / 3) * x - z / 3) / size;
  const r = ((2 / 3) * z) / size;
  const s = -q - r;

  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  // `|| 0` turns -0 into 0, so keys stay stable.
  return hex(rq || 0, rr || 0);
};

/** The six corners, counter-clockwise from the one at 30°, for drawing. */
const corners = (of: Hex, size = SIZE): Point[] => {
  const centre = toPoint(of, size);

  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);

    return {
      x: centre.x + size * Math.cos(angle),
      z: centre.z + size * Math.sin(angle),
    };
  });
};

export {
  DIRECTIONS,
  SIZE,
  add,
  corners,
  distance,
  equals,
  fromPoint,
  hex,
  key,
  neighbours,
  range,
  subtract,
  toPoint,
  type Hex,
  type Point,
};
