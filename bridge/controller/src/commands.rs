//! What the hub may tell the arm. Mirrors `client/src/controller/commands.ts`.

use crate::kinematics::{bearing, forward};
use crate::servo::rest;
use crate::state::{Arm, adopt, gripping, say};
use crate::types::{Cause, Command, Joints, Plan, Pose, Report, State};

/// Takes a plan from the hub, or says why not. A plan that arrives mid-grip waits for the grip to settle; one that arrives during an operator's hold is taken but stays held, while a sensor's hold ends with a new plan.
fn load(arm: &mut Arm, plan: Plan) {
    let latest = arm.pending.as_ref().map_or(arm.revision, |pending| pending.revision);
    let refusal = if plan.arm != arm.id {
        Some(format!("addressed to {}", plan.arm))
    } else if arm.state == State::Stopped {
        Some("stopped: reset first".to_owned())
    } else if plan.revision <= latest {
        Some(format!("revision {} is not after {}", plan.revision, latest))
    } else if plan.holding != arm.holding {
        Some(match &arm.holding {
            Some(case) => format!("holding case {case}"),
            None => "holding nothing".to_owned(),
        })
    } else {
        None
    };

    if let Some(reason) = refusal {
        say(arm, Report::Rejected { revision: plan.revision, reason });

        return;
    }

    if gripping(arm) {
        arm.pending = Some(plan);

        return;
    }

    let paused = arm.state == State::Held && arm.cause == Cause::Command;

    adopt(arm, plan);

    if paused && arm.state == State::Running {
        arm.state = State::Held;
    }
}

pub fn command(arm: &mut Arm, received: Command) {
    if received.arm() != arm.id {
        return;
    }

    match received {
        Command::Load { plan, .. } => load(arm, plan),
        Command::Hold { .. } => {
            if arm.state == State::Running {
                arm.state = State::Held;
                arm.cause = Cause::Command;
                say(arm, Report::Held { cause: Cause::Command, seen: Vec::new() });
            }
        }
        Command::Resume { .. } => {
            if arm.state == State::Held {
                let more =
                    arm.plan.as_ref().is_some_and(|plan| (arm.step as usize) < plan.instructions.len());

                arm.state = if more { State::Running } else { State::Idle };
                say(arm, Report::Resumed);
            }
        }
        Command::Stop { .. } => {
            // The emergency stop: brakes on, motors off, and the plan is gone with it.
            arm.state = State::Stopped;
            arm.drive = rest(arm.drive.joints);
            arm.plan = None;
            arm.pending = None;
            arm.segment = None;
            say(arm, Report::Stopped);
        }
        Command::Reset { .. } => {
            if arm.state == State::Stopped {
                arm.state = State::Idle;
                say(arm, Report::Reset);
            }
        }
        Command::Open { gate, .. } => {
            arm.opened.insert(gate);
        }
        Command::Seed { joints, holding, .. } => {
            // Only an arm with nothing under way: its plan's moves were made from where it stood.
            if arm.plan.is_some() && arm.state == State::Running {
                return;
            }

            let grip = if holding.is_some() { 1.0 } else { 0.0 };

            arm.drive = rest(Joints { grip, ..joints });
            arm.goal = Joints { grip, ..joints };
            arm.holding = holding;
            arm.setpoint = Pose { at: forward(&joints), facing: bearing(&joints) };
        }
    }
}
