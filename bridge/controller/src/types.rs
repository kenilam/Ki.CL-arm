//! The protocol as the controller sees it, mirroring `client/src/protocol`.
//! Reports carry no arm id here; the controller knows its own, and whoever
//! puts a report on the wire adds it.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Where the pad is sent: a position and the heading it faces, in the arm's own frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pose {
    pub at: Point,
    pub facing: f64,
}

/// Joint angles in radians. `grip` is the vacuum, from 0 (off) to 1 (holding).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Joints {
    pub yaw: f64,
    pub shoulder: f64,
    pub elbow: f64,
    pub wrist: f64,
    pub roll: f64,
    pub grip: f64,
}

/// A box square to the cell, by its lowest and highest corners.
#[derive(Clone, Debug, PartialEq)]
pub struct Obstacle {
    pub id: String,
    pub min: Point,
    pub max: Point,
}

/// How the pad moves to a pose. `Arrive` and `Leave` are the slow straight moves into and out of contact with a case; `Swing` travels at speed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Ease {
    Arrive,
    Leave,
    Swing,
}

/// One thing the arm does, in order. A `Gate` holds the arm there until the hub opens it.
#[derive(Clone, Debug, PartialEq)]
pub enum Instruction {
    Move { to: Pose, ease: Ease },
    Pick { case: String },
    Place { case: String },
    Wait { seconds: f64 },
    Gate { id: String },
}

/// A plan for one arm. A newer revision replaces whatever the arm still had to do.
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub arm: String,
    pub revision: u32,
    pub holding: Option<String>,
    pub known: Vec<String>,
    pub instructions: Vec<Instruction>,
}

/// What the hub sends an arm. `Stop` is the emergency stop; `Hold` is the gentle one.
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Load { arm: String, plan: Plan },
    Hold { arm: String },
    Resume { arm: String },
    Stop { arm: String },
    Reset { arm: String },
    Open { arm: String, gate: String },
    Seed { arm: String, joints: Joints, holding: Option<String> },
}

impl Command {
    pub fn arm(&self) -> &str {
        match self {
            Command::Load { arm, .. }
            | Command::Hold { arm }
            | Command::Resume { arm }
            | Command::Stop { arm }
            | Command::Reset { arm }
            | Command::Open { arm, .. }
            | Command::Seed { arm, .. } => arm,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum State {
    Idle,
    Running,
    Held,
    Stopped,
}

/// Why an arm is held: the operator asked, or its own sensors saw something.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Cause {
    Command,
    Sensor,
}

/// Where the arm is, sent at a steady rate whether or not anything happened.
#[derive(Clone, Debug, PartialEq)]
pub struct Telemetry {
    /// Seconds since the controller booted.
    pub at: f64,
    pub state: State,
    /// The last plan accepted, kept through a reset; none before any.
    pub revision: Option<u32>,
    /// The instruction under way, or the count when the plan is done.
    pub step: u32,
    pub joints: Joints,
    pub pad: Pose,
    pub holding: Option<String>,
    /// The joints the controller asked for, when `joints` are what the physics did instead.
    pub target: Option<Joints>,
}

/// What an arm tells the hub.
#[derive(Clone, Debug, PartialEq)]
pub enum Report {
    Telemetry(Telemetry),
    Loaded {
        revision: u32,
    },
    Rejected {
        revision: u32,
        reason: String,
    },
    Progress {
        revision: u32,
        step: u32,
    },
    Done {
        revision: u32,
    },
    Held {
        cause: Cause,
        seen: Vec<String>,
    },
    Resumed,
    Stopped,
    Reset,
    /// What perception sees in the cell, in the arm's frame. Never the controller's own: the bridge relays it.
    Seen {
        cases: Vec<Obstacle>,
        others: Vec<Obstacle>,
        held: Option<String>,
    },
}
