//! The ROS 2 side, behind the `ros2` feature. For arm id `arm-a`, the joint
//! targets its controller computes go out on `/arm_a/joint_commands` and what
//! the physics did comes back on `/arm_a/joint_states`, both
//! `sensor_msgs/JointState` with the controller's joint names. The arm in
//! Isaac Sim is `sim/arm.urdf`, whose joints are those by name and sign.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use arm_controller::Joints;
use futures_util::StreamExt;
use r2r::sensor_msgs::msg::JointState;
use r2r::{Node, Publisher, QosProfile};
use tracing::{info, warn};

const NAMES: [&str; 5] = ["yaw", "shoulder", "elbow", "wrist", "roll"];

pub struct Ros {
    node: Arc<Mutex<Node>>,
    publishers: Mutex<HashMap<String, Publisher<JointState>>>,
    /// The joints last reported by each arm's physics, by arm id.
    measured: Arc<Mutex<HashMap<String, Joints>>>,
}

/// ROS names take no dashes.
fn topic(id: &str) -> String {
    id.replace('-', "_")
}

/// The controller's joints out of a joint state message, matched by name; none if any is missing.
fn joints(state: &JointState) -> Option<Joints> {
    let at = |name: &str| {
        let index = state.name.iter().position(|one| one == name)?;

        state.position.get(index).copied()
    };

    Some(Joints {
        yaw: at("yaw")?,
        shoulder: at("shoulder")?,
        elbow: at("elbow")?,
        wrist: at("wrist")?,
        roll: at("roll")?,
        // The vacuum is not a joint the physics knows; the controller keeps that one.
        grip: 0.0,
    })
}

impl Ros {
    /// One node, `arm_bridge`, spun on its own thread.
    pub fn start() -> Result<Arc<Self>, r2r::Error> {
        let context = r2r::Context::create()?;
        let node = Arc::new(Mutex::new(Node::create(context, "arm_bridge", "")?));
        let spinner = node.clone();

        std::thread::spawn(move || {
            loop {
                spinner.lock().unwrap().spin_once(Duration::from_millis(5));
            }
        });
        info!("ros2 node arm_bridge up");

        Ok(Arc::new(Self { node, publishers: Mutex::new(HashMap::new()), measured: Arc::default() }))
    }

    /// The topics for `id`, made on first mention: a publisher for its commands, and a subscription that keeps its latest joint state.
    pub fn arm(self: &Arc<Self>, id: &str) -> Result<(), r2r::Error> {
        let mut publishers = self.publishers.lock().unwrap();

        if publishers.contains_key(id) {
            return Ok(());
        }

        let name = topic(id);
        let (publisher, mut states) = {
            let mut node = self.node.lock().unwrap();

            (
                node.create_publisher::<JointState>(
                    &format!("/{name}/joint_commands"),
                    QosProfile::default(),
                )?,
                node.subscribe::<JointState>(&format!("/{name}/joint_states"), QosProfile::default())?,
            )
        };

        publishers.insert(id.to_owned(), publisher);
        info!(arm = id, "on /{name}/joint_commands and /{name}/joint_states");

        let measured = self.measured.clone();
        let id = id.to_owned();

        tokio::spawn(async move {
            while let Some(state) = states.next().await {
                match joints(&state) {
                    Some(found) => {
                        measured.lock().unwrap().insert(id.clone(), found);
                    }
                    None => warn!(arm = %id, "a joint state without the arm's joints"),
                }
            }
        });

        Ok(())
    }

    /// Sends `id` the joint targets its controller wants.
    pub fn command(&self, id: &str, joints: &Joints) {
        let Some(publisher) = self.publishers.lock().unwrap().get(id).cloned() else {
            return;
        };
        let message = JointState {
            name: NAMES.iter().map(|name| (*name).to_owned()).collect(),
            position: vec![joints.yaw, joints.shoulder, joints.elbow, joints.wrist, joints.roll],
            ..Default::default()
        };

        if let Err(error) = publisher.publish(&message) {
            warn!(arm = id, %error, "could not publish joint targets");
        }
    }

    /// Where `id`'s physics last said its joints are.
    pub fn measured(&self, id: &str) -> Option<Joints> {
        self.measured.lock().unwrap().get(id).copied()
    }
}
