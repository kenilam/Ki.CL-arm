//! The ROS 2 side, behind the `ros2` feature. For arm id `arm-a`, the joint
//! targets its controller computes go out on `/arm_a/joint_commands` and what
//! the physics did comes back on `/arm_a/joint_states`, both
//! `sensor_msgs/JointState` with the controller's joint names. The arm in
//! Isaac Sim is `sim/arm.urdf`, whose joints are those by name and sign.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use arm_controller::Joints;
use futures_util::StreamExt;
use r2r::sensor_msgs::msg::JointState;
use r2r::std_msgs::msg::{Bool, String as Text};
use r2r::{Node, Publisher, QosProfile};
use tracing::{info, warn};

/// How long the physics may go without reporting joints before it is said.
const QUIET: Duration = Duration::from_secs(1);

const NAMES: [&str; 5] = ["yaw", "shoulder", "elbow", "wrist", "roll"];

/// What the bridge says to one arm's simulator, besides joint targets.
struct Out {
    joints: Publisher<JointState>,
    /// The cell as the hub sees it, as JSON; the simulator stages cases and pallets from it.
    cell: Publisher<Text>,
    vacuum: Publisher<Bool>,
}

pub struct Ros {
    node: Arc<Mutex<Node>>,
    publishers: Mutex<HashMap<String, Out>>,
    /// The joints last reported by each arm's physics, by arm id.
    /// Each arm's joints as the physics last reported them, and when.
    measured: Arc<Mutex<HashMap<String, (Instant, Joints)>>>,
    /// The arms whose physics have gone quiet, so it is said once.
    quiet: Mutex<HashSet<String>>,
    /// What each arm's perception last saw, kept until the bridge relays it.
    seen: Arc<Mutex<HashMap<String, Seen>>>,
}

/// One observation of a cell, as the simulator or a perception stack publishes it on `/<arm>/seen`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Seen {
    #[serde(default)]
    pub cases: Vec<SeenBox>,
    #[serde(default)]
    pub others: Vec<SeenBox>,
    #[serde(default)]
    pub held: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SeenBox {
    pub id: String,
    pub min: [f64; 3],
    pub max: [f64; 3],
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

        Ok(Arc::new(Self {
            node,
            publishers: Mutex::new(HashMap::new()),
            measured: Arc::default(),
            quiet: Mutex::default(),
            seen: Arc::default(),
        }))
    }

    /// The topics for `id`, made on first mention: a publisher for its commands, and a subscription that keeps its latest joint state.
    pub fn arm(self: &Arc<Self>, id: &str) -> Result<(), r2r::Error> {
        let mut publishers = self.publishers.lock().unwrap();

        if publishers.contains_key(id) {
            return Ok(());
        }

        let name = topic(id);
        let (out, mut states, mut sights) = {
            let mut node = self.node.lock().unwrap();
            // The cell and the vacuum are state, not a stream: a simulator that starts late gets the last of each.
            let latched = QosProfile::default().transient_local();

            (
                Out {
                    joints: node.create_publisher::<JointState>(
                        &format!("/{name}/joint_commands"),
                        QosProfile::default(),
                    )?,
                    cell: node.create_publisher::<Text>(&format!("/{name}/cell"), latched.clone())?,
                    vacuum: node.create_publisher::<Bool>(&format!("/{name}/vacuum"), latched)?,
                },
                node.subscribe::<JointState>(&format!("/{name}/joint_states"), QosProfile::default())?,
                node.subscribe::<Text>(&format!("/{name}/seen"), QosProfile::default())?,
            )
        };

        publishers.insert(id.to_owned(), out);
        info!(arm = id, "on /{name}/joint_commands, /{name}/cell, /{name}/vacuum and /{name}/joint_states");

        let seen = self.seen.clone();
        let sighted = id.to_owned();

        tokio::spawn(async move {
            while let Some(text) = sights.next().await {
                match serde_json::from_str::<Seen>(&text.data) {
                    Ok(found) => {
                        seen.lock().unwrap().insert(sighted.clone(), found);
                    }
                    Err(error) => warn!(arm = %sighted, %error, "an observation the bridge could not read"),
                }
            }
        });

        let measured = self.measured.clone();
        let id = id.to_owned();

        tokio::spawn(async move {
            while let Some(state) = states.next().await {
                match joints(&state) {
                    Some(found) => {
                        measured.lock().unwrap().insert(id.clone(), (Instant::now(), found));
                    }
                    None => warn!(arm = %id, "a joint state without the arm's joints"),
                }
            }
        });

        Ok(())
    }

    /// Sends `id` the joint targets its controller wants, and whether its vacuum is on.
    pub fn command(&self, id: &str, joints: &Joints) {
        let publishers = self.publishers.lock().unwrap();
        let Some(out) = publishers.get(id) else {
            return;
        };
        let message = JointState {
            name: NAMES.iter().map(|name| (*name).to_owned()).collect(),
            position: vec![joints.yaw, joints.shoulder, joints.elbow, joints.wrist, joints.roll],
            ..Default::default()
        };

        if let Err(error) = out.joints.publish(&message) {
            warn!(arm = id, %error, "could not publish joint targets");
        }

        if let Err(error) = out.vacuum.publish(&Bool { data: joints.grip > 0.5 }) {
            warn!(arm = id, %error, "could not publish the vacuum");
        }
    }

    /// Tells `id`'s simulator what stands in its cell: cases and pallets as boxes in the arm's frame, as JSON.
    pub fn cell(
        &self,
        id: &str,
        cases: &[arm_controller::Obstacle],
        pallets: &[arm_controller::Obstacle],
        belts: &[arm_controller::Obstacle],
    ) {
        let publishers = self.publishers.lock().unwrap();
        let Some(out) = publishers.get(id) else {
            return;
        };
        let boxes = |list: &[arm_controller::Obstacle]| {
            list.iter()
                .map(|one| {
                    format!(
                        r#"{{"id":"{}","min":[{},{},{}],"max":[{},{},{}]}}"#,
                        one.id, one.min.x, one.min.y, one.min.z, one.max.x, one.max.y, one.max.z
                    )
                })
                .collect::<Vec<_>>()
                .join(",")
        };
        let data = format!(
            r#"{{"cases":[{}],"pallets":[{}],"belts":[{}]}}"#,
            boxes(cases),
            boxes(pallets),
            boxes(belts)
        );

        if let Err(error) = out.cell.publish(&Text { data }) {
            warn!(arm = id, %error, "could not publish the cell");
        }
    }

    /// What `id`'s perception has seen since last asked, if anything.
    pub fn seen(&self, id: &str) -> Option<Seen> {
        self.seen.lock().unwrap().remove(id)
    }

    /// Where `id`'s physics last said its joints are.
    pub fn measured(&self, id: &str) -> Option<Joints> {
        let (at, joints) = self.measured.lock().unwrap().get(id).copied()?;
        let mut quiet = self.quiet.lock().unwrap();

        if at.elapsed() > QUIET {
            if quiet.insert(id.to_owned()) {
                warn!(
                    arm = id,
                    "no joint states from the physics for {}s; the last ones stand",
                    QUIET.as_secs()
                );
            }
        } else if quiet.remove(id) {
            info!(arm = id, "joint states from the physics again");
        }

        Some(joints)
    }
}
