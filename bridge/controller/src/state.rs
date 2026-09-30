//! Everything one controller box keeps between ticks. Mirrors `client/src/controller/state.ts`.

use std::collections::HashSet;

use crate::kinematics::{bearing, forward, home};
use crate::motion::Segment;
use crate::servo::{Drive, rest};
use crate::types::{Cause, Instruction, Joints, Obstacle, Plan, Pose, Report, State};

pub struct Arm {
    pub id: String,
    pub state: State,
    /// Why the arm is held: the operator, or its own sensors.
    pub cause: Cause,
    pub drive: Drive,
    pub goal: Joints,
    /// The pad pose last sent to the joints; a move starts from here.
    pub setpoint: Pose,
    pub plan: Option<Plan>,
    /// A plan that arrived mid-grip, adopted once the grip settles.
    pub pending: Option<Plan>,
    /// The last revision accepted, kept past a stop so a stale plan stays stale.
    pub revision: u32,
    pub step: u32,
    pub segment: Option<Segment>,
    pub waited: f64,
    pub holding: Option<String>,
    /// Gates the hub has opened in the plan under way.
    pub opened: HashSet<String>,
    /// What is physically around the arm, for its sensors to meet.
    pub boxes: Vec<Obstacle>,
    pub scanned: f64,
    pub clock: f64,
    pub reports: Vec<Report>,
}

pub fn boot(id: &str) -> Arm {
    let at_home = home();

    Arm {
        id: id.to_owned(),
        state: State::Idle,
        cause: Cause::Command,
        drive: rest(at_home),
        goal: at_home,
        setpoint: Pose { at: forward(&at_home), facing: bearing(&at_home) },
        plan: None,
        pending: None,
        revision: 0,
        step: 0,
        segment: None,
        waited: 0.0,
        holding: None,
        opened: HashSet::new(),
        boxes: Vec::new(),
        scanned: 0.0,
        clock: 0.0,
        reports: Vec::new(),
    }
}

pub fn say(arm: &mut Arm, report: Report) {
    arm.reports.push(report);
}

/// The instruction under way, if the plan has one at this step.
pub fn current(arm: &Arm) -> Option<&Instruction> {
    arm.plan.as_ref().and_then(|plan| plan.instructions.get(arm.step as usize))
}

/// Whether the arm is in the middle of taking or letting go of a case.
pub fn gripping(arm: &Arm) -> bool {
    arm.state == State::Running
        && matches!(current(arm), Some(Instruction::Pick { .. } | Instruction::Place { .. }))
}

/// Takes `plan` as the one to run, from its first instruction.
pub fn adopt(arm: &mut Arm, plan: Plan) {
    let revision = plan.revision;
    let empty = plan.instructions.is_empty();

    arm.pending = None;
    arm.revision = revision;
    arm.step = 0;
    arm.segment = None;
    arm.waited = 0.0;
    arm.opened.clear();
    arm.state = if empty { State::Idle } else { State::Running };
    arm.plan = Some(plan);
    say(arm, Report::Loaded { revision });

    if empty {
        say(arm, Report::Done { revision });
    }
}
