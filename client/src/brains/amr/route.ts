import { distance, equals, key, neighbours, type Hex } from 'arm/grid';

/**
 * The shortest walk over the hex grid from `from` to `to` round the blocked
 * hexes, both ends included, by A* with hex distance as the estimate. The
 * goal may itself be blocked: that is how an AMR drives into an arm cell's
 * pallet slot that is closed to traffic passing through.
 */
/** Hexes A* may visit before it gives up: enough to cross a 50-arm floor and back. */
const route = (
  from: Hex,
  to: Hex,
  blocked: ReadonlySet<string>,
  limit = 40000
): Hex[] | null => {
  const came = new Map<string, Hex>();
  const cost = new Map<string, number>([[key(from), 0]]);
  const open: { hex: Hex; score: number }[] = [
    { hex: from, score: distance(from, to) },
  ];

  for (let visited = 0; open.length && visited < limit; visited++) {
    open.sort((a, b) => a.score - b.score);

    const { hex } = open.shift()!;

    if (equals(hex, to)) {
      const path = [hex];

      for (let at = came.get(key(hex)); at; at = came.get(key(at))) {
        path.unshift(at);
      }

      return path;
    }

    neighbours(hex).forEach((next) => {
      if (blocked.has(key(next)) && !equals(next, to)) {
        return;
      }

      const spent = (cost.get(key(hex)) ?? 0) + 1;

      if (spent < (cost.get(key(next)) ?? Infinity)) {
        cost.set(key(next), spent);
        came.set(key(next), hex);
        open.push({ hex: next, score: spent + distance(next, to) });
      }
    });
  }

  return null;
};

export { route };
