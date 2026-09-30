//! The arm as the vendor describes it, and the controller's rates. Mirrors
//! `client/src/model/constants.ts` and `client/src/controller/constants.ts`.

/// Link lengths in metres. `base` is the shoulder's height off the floor, and `hand` runs from the wrist to the face of the suction pad.
pub struct Link {
    pub base: f64,
    pub upper: f64,
    pub fore: f64,
    pub hand: f64,
}

pub const LINK: Link = Link { base: 0.72, upper: 1.25, fore: 1.1, hand: 0.5 };

/// The upper arm sits this far to the side of the turret, along the pitch axis.
pub const SIDE: f64 = 0.17;

/// Limits on where the pad can be sent: `min` keeps the gripper clear of the turret, `floor` above the table, and `slack` stops the arm locking straight.
pub struct Reach {
    pub floor: f64,
    pub min: f64,
    pub slack: f64,
}

pub const REACH: Reach = Reach { floor: 0.02, min: 0.7, slack: 0.01 };

/// Where the pad waits between jobs.
pub const REST: crate::Point = crate::Point { x: 0.2, y: 1.6, z: 1.0 };

/// Top speeds: joints in radians per second, the vacuum in full draws per second. The turret's is lowest: it swings the whole arm.
pub struct Speed {
    pub grip: f64,
    pub joint: f64,
    pub yaw: f64,
}

pub const SPEED: Speed = Speed { grip: 4.0, joint: 2.0, yaw: 1.2 };

/// How fast a joint may pick up or shed speed, in radians per second squared.
pub struct Accel {
    pub joint: f64,
    pub yaw: f64,
}

pub const ACCEL: Accel = Accel { joint: 6.0, yaw: 4.0 };

/// Straight-line pad speeds in metres per second, and the distance from contact over which the pad eases between them. `swing` is the speed between.
pub struct Line {
    pub fast: f64,
    pub near: f64,
    pub slow: f64,
    pub swing: f64,
}

pub const LINE: Line = Line { fast: 1.0, near: 0.25, slow: 0.06, swing: 0.9 };

/// The servo loop's step, in seconds: a thousand a second, as a controller box runs.
pub const TICK: f64 = 0.001;

/// How often the arm's sensors are read, in seconds.
pub const SCAN: f64 = 0.01;

/// How often telemetry goes out, in seconds.
pub const REPORT: f64 = 1.0 / 60.0;

/// How close every joint must be to its goal, in radians, to count as there.
pub const SETTLED: f64 = 0.002;

/// How close the joints must be to pass a swing waypoint without stopping, in radians.
pub const PASSING: f64 = 0.05;

/// How close an arm that reports its own joints must be to the goal, in radians, for a step to count as reached.
/// Looser than `SETTLED`: a physical arm sags under gravity and trails a moving target by a little.
pub const FOLLOWED: f64 = 0.02;

/// How long the physical joints must go without moving, in seconds, to count as stopped short of the goal.
pub const STALLED: f64 = 0.5;

/// How little the physical pad may move over `STALLED`, in metres, and still count as stopped.
pub const STILL: f64 = 0.005;

/// How close a stopped pad must be to where the goal would put it, in metres, for the stop to count as arrival: a
/// pad pressed onto a case top comes no closer however long it tries. Measured at the pad, not the joints: small
/// joint errors add up to a pad far from a case, and a vacuum switched on there takes nothing.
pub const BLOCKED: f64 = 0.05;

/// The same, for the move down onto a place: a case that has come to rest on something short of the planned spot is
/// down, whatever the plan thought stood there, and holding it pressed there helps nothing.
pub const PLACING: f64 = 0.15;
