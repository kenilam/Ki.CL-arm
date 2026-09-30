//! A straight pad move under way. Mirrors `client/src/controller/motion.ts`.

use crate::constants::LINE;
use crate::kinematics::shortest;
use crate::types::{Ease, Point, Pose};

/// How long the move is, how far along, and the turn made over it.
#[derive(Clone, Debug)]
pub struct Segment {
    pub from: Pose,
    pub to: Pose,
    pub ease: Ease,
    pub length: f64,
    pub travelled: f64,
    pub turn: f64,
}

fn distance(a: &Point, b: &Point) -> f64 {
    ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt()
}

/// How fast to move along a line, given how far the pad has come and how far there is to go. Contact is at the end when arriving and at the start when leaving; within `LINE.near` of it the speed eases down to `LINE.slow`, so the pad meets a case gently and lifts it out gently.
fn speed(ease: Ease, travelled: f64, remaining: f64) -> f64 {
    if ease == Ease::Swing {
        return LINE.swing;
    }

    let near = if ease == Ease::Arrive { remaining } else { travelled };
    let share = (near / LINE.near).clamp(0.0, 1.0);
    let smooth = share * share * (3.0 - 2.0 * share);

    LINE.slow + (LINE.fast - LINE.slow) * smooth
}

pub fn begin(from: Pose, to: Pose, ease: Ease) -> Segment {
    Segment {
        from,
        to,
        ease,
        length: distance(&from.at, &to.at),
        travelled: 0.0,
        turn: shortest(from.facing, to.facing),
    }
}

/// The segment `dt` seconds further on.
pub fn advance(segment: &mut Segment, dt: f64) {
    let step = speed(segment.ease, segment.travelled, segment.length - segment.travelled) * dt;

    segment.travelled = segment.length.min(segment.travelled + step);
}

/// Where the pad is sent this step: along the line, turning as it goes.
pub fn pose(segment: &Segment) -> Pose {
    let share = if segment.length > 0.0 { segment.travelled / segment.length } else { 1.0 };
    let (from, to) = (&segment.from, &segment.to);

    Pose {
        at: Point {
            x: from.at.x + (to.at.x - from.at.x) * share,
            y: from.at.y + (to.at.y - from.at.y) * share,
            z: from.at.z + (to.at.z - from.at.z) * share,
        },
        facing: from.facing + segment.turn * share,
    }
}

pub fn finished(segment: &Segment) -> bool {
    segment.travelled >= segment.length
}
