//! Every link's frame for a set of joints. The sensors read these. Mirrors `client/src/model/frames.ts`.

use crate::constants::LINK;
use crate::types::{Joints, Point};

/// A link's origin and its x, y and z directions, in the arm's frame.
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub origin: Point,
    pub x: Point,
    pub y: Point,
    pub z: Point,
}

pub type Vector = [f64; 3];

pub struct Frames {
    /// Read by the collision model once `client/src/model/body.ts` is ported.
    #[allow(dead_code)]
    pub turret: Frame,
    pub upper: Frame,
    pub fore: Frame,
    pub wrist: Frame,
    pub gripper: Frame,
}

fn add(a: Point, b: Point, scale: f64) -> Point {
    Point { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale }
}

fn scaled(a: Point, scale: f64) -> Point {
    Point { x: a.x * scale, y: a.y * scale, z: a.z * scale }
}

/// A frame pitched by `angle` about its x.
fn pitched(origin: Point, across: Point, out: Point, angle: f64) -> Frame {
    Frame {
        origin,
        x: across,
        y: add(Point { x: 0.0, y: angle.cos(), z: 0.0 }, out, -angle.sin()),
        z: add(Point { x: 0.0, y: angle.sin(), z: 0.0 }, out, angle.cos()),
    }
}

pub fn frames(joints: &Joints) -> Frames {
    let out = Point { x: joints.yaw.sin(), y: 0.0, z: joints.yaw.cos() };
    let across = Point { x: joints.yaw.cos(), y: 0.0, z: -joints.yaw.sin() };
    let turret = Frame { origin: Point::default(), x: across, y: Point { x: 0.0, y: 1.0, z: 0.0 }, z: out };
    let upper = pitched(Point { x: 0.0, y: LINK.base, z: 0.0 }, across, out, joints.shoulder);
    let fore = pitched(add(upper.origin, upper.z, LINK.upper), across, out, joints.shoulder - joints.elbow);
    let wrist = pitched(
        add(fore.origin, fore.z, LINK.fore),
        across,
        out,
        joints.shoulder - joints.elbow + joints.wrist,
    );
    let (sin, cos) = (-joints.roll).sin_cos();
    let gripper = Frame {
        origin: wrist.origin,
        x: add(scaled(wrist.x, cos), wrist.y, sin),
        y: add(scaled(wrist.y, cos), wrist.x, -sin),
        z: wrist.z,
    };

    Frames { turret, upper, fore, wrist, gripper }
}

/// A point given in a frame's own axes, in the arm's frame.
pub fn place(frame: &Frame, [x, y, z]: Vector) -> Point {
    add(add(add(frame.origin, frame.x, x), frame.y, y), frame.z, z)
}

/// A direction given in a frame's own axes, in the arm's frame.
pub fn aim(frame: &Frame, [x, y, z]: Vector) -> Point {
    add(add(scaled(frame.x, x), frame.y, y), frame.z, z)
}
