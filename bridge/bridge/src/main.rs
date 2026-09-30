//! The bridge: one WebSocket on the machine, every frame one protobuf message,
//! an arm behind each id the hub names. Today every arm is the simulated
//! controller, the same one the browser runs, so the hub cannot tell the
//! difference; Isaac's arms come in behind the same ids through ROS 2 next.
//! Arms come into being on the first message that names them and go when the
//! last hub does, because the world they work in lives in the hub.

mod convert;
#[cfg(feature = "ros2")]
mod ros;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use arm_controller::{Controller, REPORT, TICK, Telemetry};
use arm_wire::to_arm::Body;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, broadcast};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

/// How often the loop wakes, in milliseconds; each wake runs the ticks owed since the last.
const WAKE: Duration = Duration::from_millis(4);

/// The most time one wake makes up for, in seconds, so a stalled process doesn't run a backlog.
const CATCHUP: f64 = 0.25;

#[derive(Parser)]
#[command(about = "The arm side of the wire: an arm behind each id, on one socket.")]
struct Args {
    /// The address to listen on. The hub dials ws://<here>/arm/link.
    #[arg(long, default_value = "0.0.0.0:3200")]
    listen: SocketAddr,
    /// Drive arms over ROS 2 as well: joint targets out on /<id>/joint_commands, joint states in from /<id>/joint_states.
    #[arg(long)]
    ros: bool,
}

#[cfg(feature = "ros2")]
type Ros = Option<Arc<ros::Ros>>;
#[cfg(not(feature = "ros2"))]
type Ros = Option<Arc<()>>;

/// The arms, and how many hubs are dialled in.
#[derive(Default)]
struct Arms {
    controllers: HashMap<String, Controller>,
    hubs: usize,
}

impl Arms {
    /// The controller for `id`, booted on first mention.
    fn arm(&mut self, id: &str) -> &mut Controller {
        self.controllers.entry(id.to_owned()).or_insert_with(|| {
            info!(arm = id, "booted");

            Controller::new(id)
        })
    }
}

type Shared = Arc<Mutex<Arms>>;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse().unwrap()),
        )
        .init();

    let args = Args::parse();
    let ros: Ros = if args.ros {
        #[cfg(feature = "ros2")]
        {
            Some(ros::Ros::start().expect("ROS 2 is up"))
        }
        #[cfg(not(feature = "ros2"))]
        {
            eprintln!("this bridge was built without the ros2 feature");
            std::process::exit(2);
        }
    } else {
        None
    };
    let arms: Shared = Arc::default();
    // Every report goes to every hub dialled in; a slow one drops frames rather than slowing the arms.
    let (reports, _) = broadcast::channel::<Vec<u8>>(1024);
    let listener = TcpListener::bind(args.listen).await?;

    info!("arms on ws://{}/arm/link", args.listen);
    tokio::spawn(servo_loop(arms.clone(), reports.clone(), ros.clone()));

    loop {
        let (stream, peer) = listener.accept().await?;

        tokio::spawn(session(stream, peer, arms.clone(), reports.clone(), ros.clone()));
    }
}

/// The servo loop: fixed ticks, as many as the wall clock owes, then one batch of reports and, at its rate, telemetry.
async fn servo_loop(arms: Shared, reports: broadcast::Sender<Vec<u8>>, ros: Ros) {
    let mut wake = tokio::time::interval(WAKE);
    let mut last = Instant::now();
    let mut owed = 0.0;
    let mut since = 0.0;

    loop {
        wake.tick().await;

        let now = Instant::now();

        owed = CATCHUP.min(owed + now.duration_since(last).as_secs_f64());
        last = now;

        let mut ticks = 0;

        while owed >= TICK {
            owed -= TICK;
            since += TICK;
            ticks += 1;
        }

        let telemetry = since >= REPORT;

        if telemetry {
            since = 0.0;
        }

        let mut guard = arms.lock().await;

        for controller in guard.controllers.values_mut() {
            let id = controller.id().to_owned();

            observe(&id, controller, &ros);

            for _ in 0..ticks {
                controller.tick(TICK);
            }

            let mut out = controller.drain();

            if telemetry {
                out.push(arm_controller::Report::Telemetry(telemetry_of(&id, controller, &ros)));
            }

            for report in out {
                // No hub dialled in is not an error: the arms run on regardless.
                let _ = reports.send(arm_wire::encode_report(&convert::report(&id, report)));
            }
        }
    }
}

/// Over ROS, where the physics say the joints are goes into the controller before it ticks: a step is done when the arm has arrived, not when the model has.
#[cfg(feature = "ros2")]
fn observe(id: &str, controller: &mut Controller, ros: &Ros) {
    if let Some(measured) = ros.as_ref().and_then(|ros| ros.measured(id)) {
        controller.observe(measured);
    }
}

#[cfg(not(feature = "ros2"))]
fn observe(_id: &str, _controller: &mut Controller, _ros: &Ros) {}

/// The arm's telemetry. Over ROS the controller's joints go out as the targets, and what the physics did is what the hub is told.
#[cfg(feature = "ros2")]
fn telemetry_of(id: &str, controller: &Controller, ros: &Ros) -> Telemetry {
    use arm_controller::{Pose, bearing, forward};

    let mut latest = controller.telemetry();

    if let Some(ros) = ros {
        ros.command(id, &latest.joints);

        if let Some(mut measured) = ros.measured(id) {
            measured.grip = latest.joints.grip;
            latest.joints = measured;
            latest.pad = Pose { at: forward(&measured), facing: bearing(&measured) };
        }
    }

    latest
}

#[cfg(not(feature = "ros2"))]
fn telemetry_of(_id: &str, controller: &Controller, _ros: &Ros) -> Telemetry {
    controller.telemetry()
}

/// One hub on the socket: its frames in, every arm's reports out.
async fn session(
    stream: TcpStream,
    peer: SocketAddr,
    arms: Shared,
    reports: broadcast::Sender<Vec<u8>>,
    ros: Ros,
) {
    let socket = match tokio_tungstenite::accept_async(stream).await {
        Ok(socket) => socket,
        Err(error) => {
            warn!(%peer, %error, "not a websocket");

            return;
        }
    };
    let (mut sink, mut source) = socket.split();
    let mut feed = reports.subscribe();

    {
        let mut guard = arms.lock().await;

        guard.hubs += 1;
        info!(%peer, hubs = guard.hubs, "hub connected");
    }

    loop {
        tokio::select! {
            frame = source.next() => {
                let Some(Ok(frame)) = frame else { break };

                match frame {
                    Message::Binary(bytes) => receive(&bytes, &arms, &ros).await,
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            report = feed.recv() => {
                match report {
                    Ok(bytes) => {
                        if sink.send(Message::Binary(bytes.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => warn!(%peer, dropped = n, "hub too slow"),
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let mut guard = arms.lock().await;

    guard.hubs -= 1;
    info!(%peer, hubs = guard.hubs, "hub gone");

    // The simulated world lives in the hub, so with no hub left the arms in it are gone too: the next hub starts them fresh, holding nothing.
    if guard.hubs == 0 && !guard.controllers.is_empty() {
        guard.controllers.clear();
        info!("arms cleared");
    }
}

/// One frame off the socket: a command to its arm, or the scene round it.
async fn receive(bytes: &[u8], arms: &Shared, ros: &Ros) {
    let message = match arm_wire::decode_to_arm(bytes) {
        Ok(message) => message,
        Err(error) => {
            warn!(%error, "dropped a frame");

            return;
        }
    };
    let mut guard = arms.lock().await;

    let id = match &message.body {
        Some(Body::Command(command)) => command.arm.clone(),
        Some(Body::Scene(scene)) => scene.arm.clone(),
        None => return,
    };

    // An arm's topics come with the arm.
    #[cfg(feature = "ros2")]
    if let Some(ros) = ros {
        if let Err(error) = ros.arm(&id) {
            warn!(arm = %id, %error, "no ROS 2 topics for the arm");
        }
    }
    #[cfg(not(feature = "ros2"))]
    let _ = ros;

    match message.body {
        Some(Body::Command(command)) => match convert::command(command) {
            Some(command) => guard.arm(&id).command(command),
            None => warn!("a command asked nothing"),
        },
        Some(Body::Scene(scene)) => {
            stage(&id, &scene, ros);
            guard.arm(&id).feed(convert::obstacles(scene.boxes));
        }
        None => {}
    }
}

/// Over ROS, the cases and pallets in a scene go to the arm's simulator, which stages them as physics.
#[cfg(feature = "ros2")]
fn stage(id: &str, scene: &arm_wire::Scene, ros: &Ros) {
    if let Some(ros) = ros
        && (!scene.cases.is_empty() || !scene.pallets.is_empty() || !scene.belts.is_empty())
    {
        ros.cell(
            id,
            &convert::obstacles(scene.cases.clone()),
            &convert::obstacles(scene.pallets.clone()),
            &convert::obstacles(scene.belts.clone()),
        );
    }
}

#[cfg(not(feature = "ros2"))]
fn stage(_id: &str, _scene: &arm_wire::Scene, _ros: &Ros) {}
