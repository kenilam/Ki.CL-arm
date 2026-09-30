//! The proximity sensors on the arm's links. Mirrors `client/src/controller/sensors.ts`.

use std::f64::consts::PI;

use crate::constants::{LINK, SIDE};
use crate::frames::{Frame, Frames, Vector, aim, frames, place};
use crate::types::{Joints, Obstacle};

/// A proximity sensor on one of the arm's links: where it sits and which way it looks, in that link's own axes (x across, y up from the link, z along it).
struct Sensor {
    link: Link,
    position: Vector,
    direction: Vector,
}

#[derive(Clone, Copy)]
enum Link {
    Upper,
    Fore,
    Wrist,
    Gripper,
}

/// How far a sensor sees, in metres.
pub const RANGE: f64 = 0.5;

/// Half the angle of a sensor's view, in radians: a half sphere.
pub const CONE: f64 = PI / 2.0;

/// Eight sensors, placed where the arm leads when it moves: both sides of the upper arm and forearm for the turret swing, above and below the forearm, the wrist out along the reach, and the gripper down onto what it reaches for.
const SENSORS: [Sensor; 8] = [
    Sensor {
        link: Link::Upper,
        position: [SIDE + 0.085, 0.0, LINK.upper * 0.55],
        direction: [1.0, 0.0, 0.0],
    },
    Sensor {
        link: Link::Upper,
        position: [SIDE - 0.085, 0.0, LINK.upper * 0.55],
        direction: [-1.0, 0.0, 0.0],
    },
    Sensor { link: Link::Fore, position: [0.095, 0.0, LINK.fore * 0.5], direction: [1.0, 0.0, 0.0] },
    Sensor { link: Link::Fore, position: [-0.095, 0.0, LINK.fore * 0.5], direction: [-1.0, 0.0, 0.0] },
    Sensor { link: Link::Fore, position: [0.0, 0.095, LINK.fore * 0.3], direction: [0.0, 1.0, 0.0] },
    Sensor { link: Link::Fore, position: [0.0, -0.085, LINK.fore * 0.7], direction: [0.0, -1.0, 0.0] },
    Sensor { link: Link::Wrist, position: [0.0, 0.09, 0.0], direction: [0.0, 1.0, 0.0] },
    Sensor { link: Link::Gripper, position: [0.0, 0.0, LINK.hand], direction: [0.0, 0.0, 1.0] },
];

fn frame(linked: &Frames, link: Link) -> &Frame {
    match link {
        Link::Upper => &linked.upper,
        Link::Fore => &linked.fore,
        Link::Wrist => &linked.wrist,
        Link::Gripper => &linked.gripper,
    }
}

/// The ids of the boxes any sensor sees with the arm posed at `joints`, in sensor order, a box once per sensor that sees it. A box is seen as soon as its nearest point is within range and inside the cone.
pub fn sense(joints: &Joints, boxes: &[Obstacle]) -> Vec<String> {
    let linked = frames(joints);
    let mut seen = Vec::new();

    for sensor in &SENSORS {
        let origin = place(frame(&linked, sensor.link), sensor.position);
        let look = aim(frame(&linked, sensor.link), sensor.direction);

        for Obstacle { id, min, max } in boxes {
            let nearest =
                [origin.x.clamp(min.x, max.x), origin.y.clamp(min.y, max.y), origin.z.clamp(min.z, max.z)];
            let offset = [nearest[0] - origin.x, nearest[1] - origin.y, nearest[2] - origin.z];
            let distance = (offset[0].powi(2) + offset[1].powi(2) + offset[2].powi(2)).sqrt();
            let facing = distance == 0.0
                || (offset[0] * look.x + offset[1] * look.y + offset[2] * look.z) / distance >= CONE.cos();

            if distance <= RANGE && facing {
                seen.push(id.clone());
            }
        }
    }

    seen
}
