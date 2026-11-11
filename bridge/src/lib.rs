pub mod brain;
pub mod link;

/// The frames, generated from `proto/kicl/robot/v1/robot.proto`.
pub mod wire {
    include!(concat!(env!("OUT_DIR"), "/kicl.robot.v1.rs"));
}
