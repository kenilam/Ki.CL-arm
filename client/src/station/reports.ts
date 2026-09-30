// Protocol
import type { Report } from '../protocol';

// Model
import { REST } from '../model/constants';

// Grid
import { alongBelt } from '../grid/layout';

// Partials
import { retry } from './jobs';
import { label, note, say, send, show, type Station, world } from './state';
import { place, remove } from './world';

// Spec
import { BUFFER, stays } from './spec';

/** Reads what the arm reports back into the station's picture of the cell. */
const handle = (station: Station, report: Report) => {
  switch (report.type) {
    case 'telemetry':
      station.telemetry = report;
      say(station, { type: 'telemetry', report });

      // An arm that outlived the last hub is on a revision this one never sent: number the next plan after it, or the arm refuses every plan until the count catches up.
      if (report.revision !== null && report.revision > station.revision) {
        station.revision = report.revision;
      }

      if (station.homing) {
        station.homing = false;
        send(station, [
          { do: 'move', to: { at: REST, facing: 0 }, ease: 'swing' },
        ]);
      }

      return;
    case 'rejected':
      note(station, 'arm refused the plan', 'error', report.reason);
      station.resend = true;

      return;
    case 'progress':
      return progress(station, report);
    case 'done':
      if (station.job?.revision === report.revision) {
        station.job = null;
      }

      return;
    case 'held':
      if (report.cause === 'sensor') {
        report.seen.forEach((id) => station.sensed.add(id));
        note(
          station,
          `arm found ${report.seen.join(', ')} in its way`,
          'warning',
          'planning again'
        );
        station.dirty = true;
      }

      return;
    default:
      return;
  }
};

/** One instruction done: a pick or place moves a case in the cell. */
const progress = (
  station: Station,
  { revision, step }: Extract<Report, { type: 'progress' }>
) => {
  const job = station.job;

  if (!job || revision !== job.revision) {
    return;
  }

  const done = job.steps[step];
  const act = job.acts.find((one) => one.step === step);

  // Off on a swing: the pad has left the stack's column.
  if (done?.do === 'move' && done.ease === 'swing') {
    station.touching = false;
  }

  if (!act) {
    return;
  }

  const { move } = act;

  if (act.action === 'pick') {
    const own = station.cases[move.id];

    if (own) {
      station.holding = own;
      station.cases = remove(world(station), move.id).cases;
      station.touching = true;
      note(
        station,
        `picked ${label(move.id)}`,
        move.to === BUFFER ? 'warning' : 'confirm'
      );
      show(station);
    }
  }

  if (act.action === 'place' && station.holding) {
    const held = station.holding;

    if (stays(move.to)) {
      station.cases = place(
        { cases: { ...station.cases, [move.id]: held }, obstacles: [] },
        move.id,
        move.at,
        move.facing
      ).cases;
    } else {
      const belt = station.layout.belts.find((one) => one.id === move.to);

      say(station, {
        type: 'placed',
        rider: {
          id: move.id,
          own: held,
          belt: move.to,
          distance: belt ? alongBelt(belt, move.at) : 0,
          yaw: move.facing,
          to: job.to,
        },
      });
    }

    station.holding = null;
    station.touching = true;
    note(
      station,
      `set ${label(move.id)} down`,
      move.to === BUFFER ? 'warning' : 'confirm',
      move.to === BUFFER
        ? 'on the buffer'
        : stays(move.to)
          ? 'on its own pallet'
          : 'on the belt'
    );
    // A case set down changes the cell: a case refused for want of room or a way may have one now.
    retry(station);
    show(station);
  }
};

export { handle };
