//! The proximity sensors on the arm's links. `client/src/controller/sensors.ts`
//! and the link frames in `client/src/model/frames.ts` are still to port; until
//! then a simulated arm on the bridge sees no obstacles, and a real arm's
//! sensing comes from the bridge's own perception, not from here.

use crate::types::{Joints, Obstacle};

/// The ids of the boxes any sensor sees with the arm posed at `joints`.
pub fn sense(_joints: &Joints, _boxes: &[Obstacle]) -> Vec<String> {
    Vec::new()
}
