// Protocol
import type { Box } from '../protocol';

// Partials
import type { Capacity, Target } from './board';
import type { Cell, Line } from './hub';

/**
 * A floor, as one configuration: the arms in their cells, the belt lines
 * past them, the pallets to start with, any arm's capacity, and the
 * obstacles standing on the floor, in its frame. Plain data, so it can
 * come from a file. The hub builds itself from it and is ready to run.
 */
type Floor = {
  cells: Cell[];
  lines: Line[];
  pallets: Omit<Target, 'claimed' | 'version'>[];
  capacities?: Record<string, Capacity>;
  obstacles?: Box[];
};

export type { Floor };
