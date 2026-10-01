//! One running tick. Mirrors `client/src/controller/run.ts`.

use std::collections::HashSet;

use crate::constants::{BLOCKED, FOLLOWED, NEAR, PASSING, PLACING, SCAN, STALLED, STILL, STUCK};
use crate::kinematics::{forward, solve};
use crate::motion::{advance, begin, finished, pose};
use crate::sensors::sense;
use crate::servo::{servo, settled};
use crate::state::{Arm, adopt, say};
use crate::types::Joints;
use crate::types::{Cause, Ease, Instruction, Report, State};

/// The instruction under way is done: on to the next, or to a plan that was waiting.
fn complete(arm: &mut Arm) {
    let Some(plan) = &arm.plan else {
        return;
    };
    let revision = plan.revision;
    let count = plan.instructions.len();

    say(arm, Report::Progress { revision, step: arm.step });
    arm.step += 1;
    arm.segment = None;
    arm.waited = 0.0;
    // A stop against the last goal says nothing about the next.
    arm.seen = None;
    arm.stalled = false;
    arm.stuck = 0.0;

    if let Some(pending) = arm.pending.take() {
        // Kept back through a grip: what the arm holds has changed since it was checked, so it is checked again.
        if pending.holding != arm.holding {
            let reason = match &arm.holding {
                Some(case) => format!("holding case {case}"),
                None => "holding nothing".to_owned(),
            };

            say(arm, Report::Rejected { revision: pending.revision, reason });

            return;
        }

        adopt(arm, pending);

        return;
    }

    if arm.step as usize >= count {
        arm.state = State::Idle;
        say(arm, Report::Done { revision });
    }
}

/// Reads the sensors: anything seen that the plan didn't know of holds the arm.
fn watch(arm: &mut Arm) {
    let known: HashSet<&str> =
        arm.plan.as_ref().map(|plan| plan.known.iter().map(String::as_str).collect()).unwrap_or_default();
    let mut seen: Vec<String> = Vec::new();

    for id in sense(&arm.measured.unwrap_or(arm.drive.joints), &arm.boxes) {
        if !known.contains(id.as_str()) && !seen.contains(&id) {
            seen.push(id);
        }
    }

    if !seen.is_empty() {
        arm.state = State::Held;
        arm.cause = Cause::Sensor;
        say(arm, Report::Held { cause: Cause::Sensor, seen });
    }
}

/// Keeps `stalled` current: whether the physical pad has moved less than `STILL` over the last `STALLED` seconds. At the
/// pad, not the joints: a case swinging on the vacuum joint keeps the roll jittering while the pad stands.
fn track(arm: &mut Arm) {
    let Some(mut measured) = arm.measured else {
        return;
    };
    measured.grip = 0.0;

    match arm.seen {
        Some((at, seen)) if arm.clock - at >= STALLED => {
            let now = forward(&measured);
            let was = forward(&seen);

            arm.stalled =
                ((now.x - was.x).powi(2) + (now.y - was.y).powi(2) + (now.z - was.z).powi(2)).sqrt() < STILL;
            arm.seen = Some((arm.clock, measured));
        }
        Some(_) => {}
        None => arm.seen = Some((arm.clock, measured)),
    }
}

/// Whether the arm's physical joints, when something reports them, are within `within` of the goal, or have stopped
/// with the pad within `BLOCKED` of where the goal puts it: a pad pressed onto a case comes no closer. The vacuum is
/// the controller's own, so it is not the physics' to be behind on.
fn arrived(arm: &Arm, within: f64, near: f64, short: f64) -> bool {
    arm.measured.is_none_or(|mut measured| {
        measured.grip = arm.goal.grip;

        settled(&measured, &arm.goal, Some(within))
            || blocked(&measured, &arm.goal, near)
            || (arm.stalled && blocked(&measured, &arm.goal, short))
    })
}

/// Whether the pad, with the joints as measured, is within `short` of where the goal would put it.
fn blocked(measured: &Joints, goal: &Joints, short: f64) -> bool {
    let at = forward(measured);
    let wanted = forward(goal);

    ((at.x - wanted.x).powi(2) + (at.y - wanted.y).powi(2) + (at.z - wanted.z).powi(2)).sqrt() < short
}

/// The instruction under way moves the joints a step, then the sensors are read.
pub fn run(arm: &mut Arm, dt: f64) {
    let Some(instruction) =
        arm.plan.as_ref().and_then(|plan| plan.instructions.get(arm.step as usize)).cloned()
    else {
        return;
    };

    let picking = matches!(instruction, Instruction::Pick { .. });

    track(arm);

    match instruction {
        Instruction::Move { to, ease } => {
            let mut segment = arm.segment.take().unwrap_or_else(|| begin(arm.setpoint, to, ease));

            advance(&mut segment, dt);
            arm.setpoint = pose(&segment);
            arm.goal = solve(&arm.setpoint.at, arm.goal.grip, arm.setpoint.facing);
            arm.drive = servo(&arm.drive, &arm.goal, dt);

            // A swing into another move passes through; anything else is reached exactly.
            let next = arm.plan.as_ref().and_then(|plan| plan.instructions.get(arm.step as usize + 1));
            let next_is_move = next.is_some_and(|next| matches!(next, Instruction::Move { .. }));
            // Down onto a place, a stop short is the case resting on something: that is down.
            let short = if next.is_some_and(|next| matches!(next, Instruction::Place { .. })) {
                PLACING
            } else {
                BLOCKED
            };
            let within = (ease == Ease::Swing && next_is_move).then_some(PASSING);
            // A swing waypoint the arm passes through is the model's alone: holding the streamed target there
            // until the physics caught up made them brake into every waypoint and pull away again. The physics
            // follow a little behind and have to be there only where a move ends.
            let done = finished(&segment)
                && settled(&arm.drive.joints, &arm.goal, within)
                && (within.is_some() || arrived(arm, FOLLOWED, NEAR, short));

            let stopped_short = finished(&segment) && arm.stalled && !done;

            arm.segment = Some(segment);

            if done {
                arm.stuck = 0.0;
                complete(arm);
            } else if stopped_short {
                // The physics have stopped and the pad is not where the plan wants it: something is in the way the
                // plan did not know of. Said as a hold by contact, which the station answers with a new plan.
                arm.stuck += dt;

                if arm.stuck >= STUCK {
                    arm.stuck = 0.0;
                    arm.state = State::Held;
                    arm.cause = Cause::Sensor;
                    say(arm, Report::Held { cause: Cause::Sensor, seen: vec!["contact".to_owned()] });
                }
            } else {
                arm.stuck = 0.0;
            }
        }
        Instruction::Pick { case } | Instruction::Place { case } => {
            let wanted = if picking { 1.0 } else { 0.0 };

            // The vacuum switches only once the physical arm is at the pose too: switched on the model's say-so, it
            // would let a case go from wherever the physics still are.
            if arm.goal.grip != wanted && arrived(arm, FOLLOWED, NEAR, BLOCKED) {
                arm.goal.grip = wanted;
            }

            arm.drive = servo(&arm.drive, &arm.goal, dt);

            // Switched, the step is done once the arm has come to rest, wherever the contact left it: a case taken
            // may have shoved the pad, and a case let go may have dropped the pad a little.
            if arm.goal.grip == wanted
                && settled(&arm.drive.joints, &arm.goal, None)
                && (arrived(arm, FOLLOWED, NEAR, PLACING) || arm.stalled)
            {
                arm.holding = picking.then_some(case);
                complete(arm);
            }
        }
        Instruction::Wait { seconds } => {
            arm.drive = servo(&arm.drive, &arm.goal, dt);
            arm.waited += dt;

            if arm.waited >= seconds {
                complete(arm);
            }
        }
        Instruction::Gate { id } => {
            arm.drive = servo(&arm.drive, &arm.goal, dt);

            if arm.opened.contains(&id) {
                complete(arm);
            }
        }
    }

    arm.scanned += dt;

    if arm.scanned >= SCAN {
        arm.scanned = 0.0;
        watch(arm);
    }
}
