//! Between the wire's messages and the controller's types. The wire carries the
//! arm's id on every message; the controller knows its own, so it goes on here.

use arm_controller as ctl;
use arm_wire as wire;

pub fn point(from: Option<wire::Point>) -> ctl::Point {
    let p = from.unwrap_or_default();

    ctl::Point { x: p.x, y: p.y, z: p.z }
}

fn pose(from: Option<wire::Pose>) -> ctl::Pose {
    let p = from.unwrap_or_default();

    ctl::Pose { at: point(p.at), facing: p.facing }
}

fn ease(from: i32) -> Option<ctl::Ease> {
    match wire::Ease::try_from(from).ok()? {
        wire::Ease::Arrive => Some(ctl::Ease::Arrive),
        wire::Ease::Leave => Some(ctl::Ease::Leave),
        wire::Ease::Swing => Some(ctl::Ease::Swing),
        wire::Ease::Unspecified => None,
    }
}

fn instruction(from: wire::Instruction) -> Option<ctl::Instruction> {
    use wire::instruction::Do;

    Some(match from.r#do? {
        Do::Move(m) => ctl::Instruction::Move { to: pose(m.to), ease: ease(m.ease)? },
        Do::Pick(p) => ctl::Instruction::Pick { case: p.case_id },
        Do::Place(p) => ctl::Instruction::Place { case: p.case_id },
        Do::Wait(w) => ctl::Instruction::Wait { seconds: w.seconds },
        Do::Gate(g) => ctl::Instruction::Gate { id: g.id },
    })
}

fn plan(from: wire::Plan) -> Option<ctl::Plan> {
    Some(ctl::Plan {
        arm: from.arm,
        revision: from.revision,
        holding: from.holding,
        known: from.known,
        instructions: from.instructions.into_iter().map(instruction).collect::<Option<Vec<_>>>()?,
    })
}

/// A command off the wire, or none for one that asks nothing the controller knows.
pub fn command(from: wire::Command) -> Option<ctl::Command> {
    use wire::command::Type;

    let arm = from.arm;

    Some(match from.r#type? {
        Type::Load(p) => ctl::Command::Load { arm, plan: plan(p)? },
        Type::Hold(_) => ctl::Command::Hold { arm },
        Type::Resume(_) => ctl::Command::Resume { arm },
        Type::Stop(_) => ctl::Command::Stop { arm },
        Type::Reset(_) => ctl::Command::Reset { arm },
        Type::Open(o) => ctl::Command::Open { arm, gate: o.gate },
    })
}

pub fn obstacles(from: Vec<wire::Box>) -> Vec<ctl::Obstacle> {
    from.into_iter().map(|b| ctl::Obstacle { id: b.id, min: point(b.min), max: point(b.max) }).collect()
}

fn state(from: ctl::State) -> wire::State {
    match from {
        ctl::State::Idle => wire::State::Idle,
        ctl::State::Running => wire::State::Running,
        ctl::State::Held => wire::State::Held,
        ctl::State::Stopped => wire::State::Stopped,
    }
}

fn cause(from: ctl::Cause) -> wire::Cause {
    match from {
        ctl::Cause::Command => wire::Cause::Command,
        ctl::Cause::Sensor => wire::Cause::Sensor,
    }
}

fn joints(j: ctl::Joints) -> wire::Joints {
    wire::Joints {
        yaw: j.yaw,
        shoulder: j.shoulder,
        elbow: j.elbow,
        wrist: j.wrist,
        roll: j.roll,
        grip: j.grip,
    }
}

fn telemetry(from: ctl::Telemetry) -> wire::Telemetry {
    wire::Telemetry {
        at: from.at,
        state: state(from.state) as i32,
        revision: from.revision,
        step: from.step,
        joints: Some(joints(from.joints)),
        target: from.target.map(joints),
        pad: Some(wire::Pose {
            at: Some(wire::Point { x: from.pad.at.x, y: from.pad.at.y, z: from.pad.at.z }),
            facing: from.pad.facing,
        }),
        holding: from.holding,
    }
}

/// A report for the wire, from `arm`.
pub fn report(arm: &str, from: ctl::Report) -> wire::Report {
    use wire::report::{self as r, Type};

    let r#type = match from {
        ctl::Report::Telemetry(t) => Type::Telemetry(telemetry(t)),
        ctl::Report::Loaded { revision } => Type::Loaded(r::Loaded { revision }),
        ctl::Report::Rejected { revision, reason } => Type::Rejected(r::Rejected { revision, reason }),
        ctl::Report::Progress { revision, step } => Type::Progress(r::Progress { revision, step }),
        ctl::Report::Done { revision } => Type::Done(r::Done { revision }),
        ctl::Report::Held { cause: c, seen } => Type::Held(r::Held { cause: cause(c) as i32, seen }),
        ctl::Report::Resumed => Type::Resumed(r::Resumed {}),
        ctl::Report::Stopped => Type::Stopped(r::Stopped {}),
        ctl::Report::Reset => Type::Reset(r::Reset {}),
    };

    wire::Report { arm: arm.to_owned(), r#type: Some(r#type) }
}
