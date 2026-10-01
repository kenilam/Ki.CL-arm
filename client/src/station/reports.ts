// Protocol
import type { Report } from '../protocol';

// Model
import { REST } from '../model/constants';

// Grid
import { alongBelt } from '../grid/layout';

// Partials
import { cancel, replan, retry } from './jobs';
import { DRIFT, RESEND, STRAYED } from './constants';
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
    case 'loaded':
      // A plan got in: whatever was refused before it is superseded, not to be sent again.
      station.resend = false;

      return;
    case 'rejected':
      note(station, 'refused', 'error', report.reason);
      reconcile(station);
      station.resend = true;
      station.resendAt = station.clock + RESEND;

      return;
    case 'progress':
      return progress(station, report);
    case 'done':
      if (station.job?.revision === report.revision) {
        station.job = null;
      }

      return;
    case 'seen':
      return observe(station, report);
    case 'held':
      if (report.cause === 'sensor') {
        note(
          station,
          `${report.seen.join(', ')} in the way`,
          'warning',
          'planning again'
        );

        // A hold by contact names nothing the planner could route round: the physics stopped short of a
        // pose. The only answer is a new plan from where the arm is, now.
        if (report.seen.includes('contact')) {
          replan(station);

          return;
        }

        report.seen.forEach((id) => station.sensed.add(id));
        station.dirty = true;
      }

      return;
    default:
      return;
  }
};

/**
 * The arm's word on what is on its pad beats the station's: after a refusal
 * the station takes the arm's `holding` as its own, so the next plan is not
 * refused for the same reason. A case the that the station had
 * standing in the cell comes off the cell; one the station thought held
 * that the arm says is gone is dropped from the picture, and said.
 */
const reconcile = (station: Station) => {
  const truth = station.telemetry?.holding ?? null;
  const own = station.holding?.id ?? null;

  if (truth === own) {
    return;
  }

  if (truth) {
    const standing = station.cases[truth];

    if (!standing) {
      // Nothing to plan with: no size, no place it came from. The arm keeps it, and the operator is told.
      note(station, `${label(truth)} unknown`, 'error', 'waiting');
      cancel(station);
      station.resend = false;

      return;
    }

    station.holding = standing;
    station.cases = remove(world(station), truth).cases;
    note(station, `${label(truth)}`, 'warning', 'has warning');
  } else {
    note(station, `${label(own!)} lost`, 'warning', 'not on the pad');
    station.holding = null;
  }

  show(station);
};

/**
 * Perception's picture of the cell beats the station's: a case seen away
 * from where the station had it is moved there, so the next plan starts
 * from where things are. Said in the log when it has strayed far, once.
 * Cases seen that the station has no record of are left to the sensors.
 */
const observe = (
  station: Station,
  { cases, held }: Extract<Report, { type: 'seen' }>
) => {
  let moved = false;

  cases.forEach(({ id, min, max }) => {
    const own = station.cases[id];

    if (!own) {
      return;
    }

    const at = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const far = Math.hypot(at.x - own.at.x, at.y - own.at.y, at.z - own.at.z);

    if (far < DRIFT) {
      return;
    }

    if (far > STRAYED && !station.strayed.has(id)) {
      station.strayed.add(id);
      note(
        station,
        `${label(id)} strayed`,
        'warning',
        `${Math.round(far * 100)} cm from its place`
      );
    }

    own.at = at;
    moved = true;
  });

  if (held && held !== station.holding?.id && !station.strayed.has(held)) {
    station.strayed.add(held);
    note(
      station,
      `pad holds ${label(held)}`,
      'warning',
      'not the case planned'
    );
  }

  if (moved) {
    show(station);
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
          ? 'own pallet'
          : 'on the belt'
    );
    // A case set down changes the cell: a case refused for want of room or a way may have one now.
    retry(station);
    show(station);
  }
};

export { handle };
