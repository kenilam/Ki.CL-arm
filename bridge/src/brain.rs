//! What answers the floor until physical AI is behind the bridge: every robot
//! holds still. An arm keeps its joints where they are and its vacuum as it
//! is, so nothing it holds is dropped; an AMR stops with its deck as it is.

use crate::wire::{AmrCommands, ArmCommands, Commands, Sensors, commands, sensors};

pub fn answer(frame: &Sensors) -> Option<Commands> {
    let robot = match frame.robot.as_ref()? {
        sensors::Robot::Arm(arm) => commands::Robot::Arm(ArmCommands {
            target: arm.position,
            vacuum: arm.gripper.is_some_and(|gripper| gripper.vacuum),
        }),
        sensors::Robot::Amr(amr) => commands::Robot::Amr(AmrCommands {
            speed: 0.0,
            turn: 0.0,
            lift: amr.lifted,
            done: String::new(),
        }),
    };

    Some(Commands {
        id: frame.id.clone(),
        tick: frame.tick,
        robot: Some(robot),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::{AmrSensors, ArmSensors, Gripper, Joints};

    #[test]
    fn an_arm_holds_its_joints_and_its_grip() {
        let position = Joints {
            base: 0.4,
            shoulder: -0.3,
            elbow: 0.2,
            wrist: 0.1,
            flange: 1.0,
        };
        let frame = Sensors {
            id: "arm-0".into(),
            tick: 7,
            time: 1.0,
            robot: Some(sensors::Robot::Arm(ArmSensors {
                position: Some(position),
                gripper: Some(Gripper {
                    vacuum: true,
                    contact: true,
                    payload: 8.0,
                }),
                ..Default::default()
            })),
        };

        let Some(commands::Robot::Arm(arm)) = answer(&frame).and_then(|c| c.robot) else {
            panic!("no arm commands");
        };

        assert_eq!(arm.target, Some(position));
        assert!(arm.vacuum);
    }

    #[test]
    fn an_amr_stops_with_its_deck_as_it_is() {
        let frame = Sensors {
            id: "amr-0".into(),
            tick: 3,
            time: 0.5,
            robot: Some(sensors::Robot::Amr(AmrSensors {
                lifted: true,
                ..Default::default()
            })),
        };
        let commands = answer(&frame).expect("commands");

        assert_eq!(commands.tick, 3);
        assert_eq!(
            commands.robot,
            Some(commands::Robot::Amr(AmrCommands {
                speed: 0.0,
                turn: 0.0,
                lift: true,
                done: String::new()
            }))
        );
    }
}
