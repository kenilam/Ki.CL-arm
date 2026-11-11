import { DIRECTIONS, add, equals, hex, neighbours, subtract, type Hex } from './hex';

/*
 * An arm cell is a rosette: one hex and its six neighbours. Rosettes tile the
 * grid with no gaps or overlaps, so every hex belongs to exactly one cell.
 *
 * (q + 3r) mod 7 is 0 on every cell centre and gives each of a centre's six
 * neighbours a different residue from 1 to 6. It is additive, so the residue
 * of any hex names the direction back to its own centre.
 */

const residue = ({ q, r }: Hex) => (((q + 3 * r) % 7) + 7) % 7;

/** The direction from a centre to its neighbour with each residue; index 0 is the centre itself. */
const BY_RESIDUE: readonly Hex[] = (() => {
  const table: Hex[] = [hex(0, 0)];

  DIRECTIONS.forEach((direction) => {
    table[residue(direction)] = direction;
  });

  return table;
})();

/** The centre of the cell `of` belongs to. */
const centreOf = (of: Hex): Hex => subtract(of, BY_RESIDUE[residue(of)]);

const isCentre = (of: Hex) => residue(of) === 0;

/** The six hexes round a centre, where pallets go. */
const slots = (centre: Hex): Hex[] => neighbours(centre);

/** The centre and its six slots. */
const members = (centre: Hex): Hex[] => [centre, ...slots(centre)];

const contains = (centre: Hex, of: Hex) => equals(centreOf(of), centre);

/** The six neighbouring cells' centres, three steps away. */
const adjacentCentres = (centre: Hex): Hex[] =>
  [hex(3, -1), hex(1, 2), hex(-2, 3), hex(-3, 1), hex(-1, -2), hex(2, -3)].map(
    (offset) => add(centre, offset)
  );

export {
  adjacentCentres,
  centreOf,
  contains,
  isCentre,
  members,
  residue,
  slots,
};
