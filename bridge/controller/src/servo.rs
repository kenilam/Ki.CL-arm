//! The motors. Mirrors `client/src/controller/servo.ts`.

use crate::constants::{ACCEL, SETTLED, SPEED};
use crate::kinematics::{nearest, shortest};
use crate::types::Joints;

/// Where each joint is, how fast it turns, and the last goal it was given.
#[derive(Clone, Debug)]
pub struct Drive {
    pub joints: Joints,
    pub velocity: Joints,
    pub goal: Option<Joints>,
}

#[derive(Clone, Copy)]
enum Name {
    Yaw,
    Shoulder,
    Elbow,
    Wrist,
    Roll,
    Grip,
}

const NAMES: [Name; 6] = [Name::Yaw, Name::Shoulder, Name::Elbow, Name::Wrist, Name::Roll, Name::Grip];

fn get(joints: &Joints, name: Name) -> f64 {
    match name {
        Name::Yaw => joints.yaw,
        Name::Shoulder => joints.shoulder,
        Name::Elbow => joints.elbow,
        Name::Wrist => joints.wrist,
        Name::Roll => joints.roll,
        Name::Grip => joints.grip,
    }
}

fn set(joints: &mut Joints, name: Name, value: f64) {
    match name {
        Name::Yaw => joints.yaw = value,
        Name::Shoulder => joints.shoulder = value,
        Name::Elbow => joints.elbow = value,
        Name::Wrist => joints.wrist = value,
        Name::Roll => joints.roll = value,
        Name::Grip => joints.grip = value,
    }
}

/// Each joint's speed and acceleration caps. The vacuum has no inertia.
fn limits(name: Name) -> (f64, f64) {
    match name {
        Name::Yaw => (SPEED.yaw, ACCEL.yaw),
        Name::Grip => (SPEED.grip, f64::INFINITY),
        _ => (SPEED.joint, ACCEL.joint),
    }
}

fn clamp(value: f64, limit: f64) -> f64 {
    value.min(limit).max(-limit)
}

/// JavaScript's `Math.sign`: zero for zero, where Rust's `signum` says one.
fn sign(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        0.0
    }
}

/// The turn from `from` to `to` for a joint: the short way round for the turret, and for the pad's roll, which lines up the same either way round.
fn gap(name: Name, from: f64, to: f64) -> f64 {
    match name {
        Name::Yaw => shortest(from, to),
        Name::Roll => nearest(from, to),
        _ => to - from,
    }
}

/// Motors at rest at `joints`.
pub fn rest(joints: Joints) -> Drive {
    Drive { joints, velocity: Joints::default(), goal: None }
}

/// One servo step: each joint moves toward `goal` within its speed and acceleration caps. The goal's own motion since last step is fed forward, so a moving setpoint is tracked without lag; on top of that, each joint closes its gap at the speed it can still brake from, so it arrives without overshoot when the setpoint stops.
pub fn servo(drive: &Drive, goal: &Joints, dt: f64) -> Drive {
    let mut joints = drive.joints;
    let mut velocity = drive.velocity;

    for name in NAMES {
        let (speed, accel) = limits(name);
        let left = gap(name, get(&drive.joints, name), get(goal, name));
        let feed = match &drive.goal {
            Some(last) => gap(name, get(last, name), get(goal, name)) / dt,
            None => 0.0,
        };
        // No inertia: the joint just goes, as fast as it may. Otherwise it closes the gap at the speed it can still brake from.
        let close =
            if accel.is_infinite() { left / dt } else { sign(left) * (2.0 * accel * left.abs()).sqrt() };
        let want = clamp(feed + close, speed);
        let was = get(&drive.velocity, name);
        let next = if accel.is_infinite() { want } else { was + clamp(want - was, accel * dt) };

        set(&mut velocity, name, next);
        set(&mut joints, name, get(&drive.joints, name) + next * dt);
    }

    Drive { joints, velocity, goal: Some(*goal) }
}

/// One step of braking: every joint sheds speed as fast as it may, and the goal is forgotten.
pub fn brake(drive: &Drive, dt: f64) -> Drive {
    let mut joints = drive.joints;
    let mut velocity = drive.velocity;

    for name in NAMES {
        let (_, accel) = limits(name);
        let was = get(&drive.velocity, name);
        let next = if accel.is_infinite() { 0.0 } else { was - clamp(was, accel * dt) };

        set(&mut velocity, name, next);
        set(&mut joints, name, get(&drive.joints, name) + next * dt);
    }

    Drive { joints, velocity, goal: None }
}

/// Whether every joint is at its goal, to within `within` radians.
pub fn settled(joints: &Joints, goal: &Joints, within: Option<f64>) -> bool {
    let within = within.unwrap_or(SETTLED);

    NAMES.iter().all(|&name| gap(name, get(joints, name), get(goal, name)).abs() < within)
}
