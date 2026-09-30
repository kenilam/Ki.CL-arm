//! One running tick. Mirrors `client/src/controller/run.ts`.

use std::collections::HashSet;

use crate::constants::{FOLLOWED, PASSING, SCAN};
use crate::kinematics::solve;
use crate::motion::{advance, begin, finished, pose};
use crate::sensors::sense;
use crate::servo::{servo, settled};
use crate::state::{Arm, adopt, say};
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

    if let Some(pending) = arm.pending.take() {
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

/// Whether the arm's physical joints, when something reports them, are within `within` of the goal. The vacuum is the controller's own, so it is not the physics' to be behind on.
fn arrived(arm: &Arm, within: f64) -> bool {
    arm.measured.is_none_or(|mut measured| {
        measured.grip = arm.goal.grip;

        settled(&measured, &arm.goal, Some(within))
    })
}

/// The instruction under way moves the joints a step, then the sensors are read.
pub fn run(arm: &mut Arm, dt: f64) {
    let Some(instruction) =
        arm.plan.as_ref().and_then(|plan| plan.instructions.get(arm.step as usize)).cloned()
    else {
        return;
    };

    let picking = matches!(instruction, Instruction::Pick { .. });

    match instruction {
        Instruction::Move { to, ease } => {
            let mut segment = arm.segment.take().unwrap_or_else(|| begin(arm.setpoint, to, ease));

            advance(&mut segment, dt);
            arm.setpoint = pose(&segment);
            arm.goal = solve(&arm.setpoint.at, arm.goal.grip, arm.setpoint.facing);
            arm.drive = servo(&arm.drive, &arm.goal, dt);

            // A swing into another move passes through; anything else is reached exactly.
            let next_is_move = arm
                .plan
                .as_ref()
                .and_then(|plan| plan.instructions.get(arm.step as usize + 1))
                .is_some_and(|next| matches!(next, Instruction::Move { .. }));
            let within = (ease == Ease::Swing && next_is_move).then_some(PASSING);
            let done = finished(&segment)
                && settled(&arm.drive.joints, &arm.goal, within)
                && arrived(arm, within.map_or(FOLLOWED, |passing| passing.max(FOLLOWED)));

            arm.segment = Some(segment);

            if done {
                complete(arm);
            }
        }
        Instruction::Pick { case } | Instruction::Place { case } => {
            arm.goal.grip = if picking { 1.0 } else { 0.0 };
            arm.drive = servo(&arm.drive, &arm.goal, dt);

            if settled(&arm.drive.joints, &arm.goal, None) {
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
