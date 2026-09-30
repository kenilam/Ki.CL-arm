//! One arm's controller box, ported line for line from `client/src/controller`
//! and `client/src/model/kinematics.ts`. It takes plans, drives the joints
//! toward each instruction at a fixed tick, and reports back. It knows the
//! arm's geometry and nothing about the cell. Change this and the TypeScript
//! together until the browser runs this crate as Wasm.

mod commands;
mod constants;
mod frames;
mod kinematics;
mod motion;
mod run;
mod sensors;
mod servo;
mod state;
mod types;

pub use constants::{FOLLOWED, REPORT, TICK};
pub use kinematics::{bearing, forward, home, solve};
pub use types::*;

use state::Arm;

/// One arm's controller. `feed` tells it what is physically around it, standing in for what the sensors would meet on a real arm.
pub struct Controller {
    arm: Arm,
}

impl Controller {
    pub fn new(id: &str) -> Self {
        Self { arm: state::boot(id) }
    }

    pub fn id(&self) -> &str {
        &self.arm.id
    }

    pub fn command(&mut self, received: Command) {
        commands::command(&mut self.arm, received);
    }

    pub fn feed(&mut self, boxes: Vec<Obstacle>) {
        self.arm.boxes = boxes;
    }

    /// Tells the controller where the arm's joints physically are, from the simulator or a real arm. From then on a step is done only when these have arrived, and the sensors are read from here. The browser's simulated arm never calls this: its joints are the servo model's.
    pub fn observe(&mut self, joints: Joints) {
        self.arm.measured = Some(joints);
    }

    /// One servo tick of `dt` seconds. Held or idle, the joints brake; stopped, nothing moves.
    pub fn tick(&mut self, dt: f64) {
        self.arm.clock += dt;

        match self.arm.state {
            State::Running => run::run(&mut self.arm, dt),
            State::Stopped => {}
            _ => self.arm.drive = servo::brake(&self.arm.drive, dt),
        }
    }

    /// The reports since last asked.
    pub fn drain(&mut self) -> Vec<Report> {
        std::mem::take(&mut self.arm.reports)
    }

    pub fn telemetry(&self) -> Telemetry {
        let arm = &self.arm;

        Telemetry {
            at: arm.clock,
            state: arm.state,
            // The last accepted, not the plan under way: it survives a reset, so a new hub can number its plans after it.
            revision: (arm.revision > 0).then_some(arm.revision),
            step: arm.step,
            joints: arm.drive.joints,
            pad: Pose { at: forward(&arm.drive.joints), facing: bearing(&arm.drive.joints) },
            holding: arm.holding.clone(),
        }
    }
}

#[cfg(test)]
mod tests;
