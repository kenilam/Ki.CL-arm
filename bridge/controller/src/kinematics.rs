//! Where the pad is for a set of joints, and the joints that put it somewhere.
//! Mirrors `client/src/model/kinematics.ts`.

use std::f64::consts::PI;

use crate::constants::{LINK, REACH, REST};
use crate::types::{Joints, Point};

/// JavaScript's `Math.round`: halves go up, not away from zero.
fn round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// The pad is a rectangle, so it lines up the same turned half a turn either way. This picks the roll within a quarter turn of straight.
fn quarter(angle: f64) -> f64 {
    angle - PI * round(angle / PI)
}

/// The pad's heading on the floor plan.
pub fn bearing(joints: &Joints) -> f64 {
    joints.yaw + joints.roll
}

/// Shortest signed turn from one heading to another, in `[-π, π]`.
pub fn shortest(from: f64, to: f64) -> f64 {
    (to - from).sin().atan2((to - from).cos())
}

/// Shortest turn of the pad from one roll to another, in `[-π/2, π/2]`: half a turn round lines it up the same.
pub fn nearest(from: f64, to: f64) -> f64 {
    shortest(2.0 * from, 2.0 * to) / 2.0
}

/// Joint angles that put the suction pad on `target` with the hand pointing straight down, elbow up, and the pad turned to `facing`. A target out of reach is pulled back onto the edge of the workspace, so the arm always has an answer.
pub fn solve(target: &Point, grip: f64, facing: f64) -> Joints {
    let yaw = target.x.atan2(target.z);

    // The hand points down, so the wrist sits one hand length above the target.
    let mut radius = target.x.hypot(target.z).max(REACH.min);
    let mut height = target.y.max(REACH.floor) + LINK.hand - LINK.base;

    let distance = radius.hypot(height);
    let reach = LINK.upper + LINK.fore - REACH.slack;

    if distance > reach {
        radius *= reach / distance;
        height *= reach / distance;
    }

    let cosine = (radius.powi(2) + height.powi(2) - LINK.upper.powi(2) - LINK.fore.powi(2))
        / (2.0 * LINK.upper * LINK.fore);
    let elbow = cosine.clamp(-1.0, 1.0).acos();
    let shoulder =
        height.atan2(radius) + (LINK.fore * elbow.sin()).atan2(LINK.upper + LINK.fore * elbow.cos());

    Joints { yaw, shoulder, elbow, wrist: -PI / 2.0 - shoulder + elbow, roll: quarter(facing - yaw), grip }
}

/// Where the suction pad is for a set of joint angles.
pub fn forward(joints: &Joints) -> Point {
    let fore = joints.shoulder - joints.elbow;
    let hand = fore + joints.wrist;
    let radius = LINK.upper * joints.shoulder.cos() + LINK.fore * fore.cos() + LINK.hand * hand.cos();

    Point {
        x: radius * joints.yaw.sin(),
        y: LINK.base + LINK.upper * joints.shoulder.sin() + LINK.fore * fore.sin() + LINK.hand * hand.sin(),
        z: radius * joints.yaw.cos(),
    }
}

/// Where the arm rests: the pad up and in front of the base.
pub fn home() -> Joints {
    solve(&REST, 0.0, 0.0)
}
