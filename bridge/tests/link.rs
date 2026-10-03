//! The bridge over a real socket, the way the page dials it.

use futures_util::{SinkExt, StreamExt};
use prost::Message as _;
use robot_bridge::{
    link,
    wire::{
        ArmSensors, Attach, FromBridge, Gripper, Joints, SensorBatch, Sensors, ToBridge, attach,
        commands, sensors, to_bridge,
    },
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

fn frame(id: &str, tick: u32) -> Sensors {
    Sensors {
        id: id.into(),
        tick,
        time: f64::from(tick) / 50.0,
        robot: Some(sensors::Robot::Arm(ArmSensors {
            position: Some(Joints {
                base: 0.5,
                ..Default::default()
            }),
            gripper: Some(Gripper {
                vacuum: true,
                ..Default::default()
            }),
            ..Default::default()
        })),
    }
}

fn bytes(message: to_bridge::Message) -> Message {
    Message::Binary(
        ToBridge {
            message: Some(message),
        }
        .encode_to_vec()
        .into(),
    )
}

#[tokio::test]
async fn answers_only_the_robots_attached_on_the_socket() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();

    tokio::spawn(async move { axum::serve(listener, link::router("../client/dist", None)).await });

    let (mut socket, _) = connect_async(format!("ws://{address}/arm/link"))
        .await
        .unwrap();

    socket
        .send(bytes(to_bridge::Message::Attach(Attach {
            id: "arm-0".into(),
            robot: attach::Robot::Arm.into(),
            blocked: vec![],
            handover: None,
        })))
        .await
        .unwrap();
    socket
        .send(bytes(to_bridge::Message::Sensors(SensorBatch {
            frames: vec![frame("arm-0", 4), frame("arm-1", 4)],
        })))
        .await
        .unwrap();

    let Some(Ok(Message::Binary(reply))) = socket.next().await else {
        panic!("no reply");
    };
    let reply = FromBridge::decode(reply).unwrap();

    assert_eq!(reply.commands.len(), 1);
    assert_eq!(reply.commands[0].id, "arm-0");
    assert_eq!(reply.commands[0].tick, 4);

    let Some(commands::Robot::Arm(arm)) = &reply.commands[0].robot else {
        panic!("not arm commands");
    };

    assert_eq!(arm.target.map(|joints| joints.base), Some(0.5));
    assert!(arm.vacuum);
}

#[tokio::test]
async fn serves_the_remote_under_arm_client() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let client = std::env::temp_dir().join(format!("arm-client-{}", std::process::id()));

    std::fs::create_dir_all(&client).unwrap();
    std::fs::write(client.join("remoteEntry.js"), "export const arm = 1;").unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();

    tokio::spawn(async move { axum::serve(listener, link::router(client, None)).await });

    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();

    stream
        .write_all(
            b"GET /arm/client/remoteEntry.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();

    let mut response = String::new();

    stream.read_to_string(&mut response).await.unwrap();

    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("text/javascript"), "{response}");
    assert!(response.ends_with("export const arm = 1;"), "{response}");
}

#[tokio::test]
async fn relays_to_the_twin_when_there_is_one() {
    // A stand-in twin: a bridge that holds still, as the real twin answers in the same frames.
    let twin = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let twin_address = twin.local_addr().unwrap();

    tokio::spawn(async move { axum::serve(twin, link::router("../client/dist", None)).await });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = Some(format!("ws://{twin_address}/arm/link"));

    tokio::spawn(
        async move { axum::serve(listener, link::router("../client/dist", upstream)).await },
    );

    let (mut socket, _) = connect_async(format!("ws://{address}/arm/link"))
        .await
        .unwrap();

    socket
        .send(bytes(to_bridge::Message::Attach(Attach {
            id: "arm-0".into(),
            robot: attach::Robot::Arm.into(),
            blocked: vec![],
            handover: None,
        })))
        .await
        .unwrap();
    socket
        .send(bytes(to_bridge::Message::Sensors(SensorBatch {
            frames: vec![frame("arm-0", 8)],
        })))
        .await
        .unwrap();

    let Some(Ok(Message::Binary(reply))) = socket.next().await else {
        panic!("no reply through the relay");
    };

    assert_eq!(FromBridge::decode(reply).unwrap().commands[0].tick, 8);
}

#[tokio::test]
async fn holds_still_when_the_twin_is_unreachable() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = Some("ws://127.0.0.1:9/arm/link".to_string());

    tokio::spawn(
        async move { axum::serve(listener, link::router("../client/dist", upstream)).await },
    );

    let (mut socket, _) = connect_async(format!("ws://{address}/arm/link"))
        .await
        .unwrap();

    socket
        .send(bytes(to_bridge::Message::Attach(Attach {
            id: "arm-0".into(),
            robot: attach::Robot::Arm.into(),
            blocked: vec![],
            handover: None,
        })))
        .await
        .unwrap();
    socket
        .send(bytes(to_bridge::Message::Sensors(SensorBatch {
            frames: vec![frame("arm-0", 2)],
        })))
        .await
        .unwrap();

    let Some(Ok(Message::Binary(reply))) = socket.next().await else {
        panic!("no reply");
    };

    assert_eq!(FromBridge::decode(reply).unwrap().commands[0].tick, 2);
}
