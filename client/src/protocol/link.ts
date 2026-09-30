import type { Command } from './commands';
import type { Box } from './geometry';
import type { Report } from './reports';

/**
 * One arm from the hub's side of the wire, whatever carries it: a worker on
 * this page, a socket to a controller box on the shop floor. The hub keeps
 * one per arm and never sees the difference.
 */
/**
 * The simulation's side door on a link: what is physically round the arm, in
 * its frame. `boxes` are the obstacles its sensors would meet; `cases` and
 * `pallets` are what stands in its cell, for a simulator that stages the
 * cell as physics. A real arm sees the world itself.
 */
type Feed = (
  boxes: Box[],
  cases?: Box[],
  pallets?: Box[],
  belts?: Box[]
) => void;

type Link = {
  arm: string;
  send: (command: Command) => void;
  listen: (handler: (report: Report) => void) => () => void;
  close: () => void;
};

export type { Feed, Link };
