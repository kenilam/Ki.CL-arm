//! What Ki.CL proxies under `/arm`: the `arm` remote's build at
//! `/arm/client/*`, and the socket the page dials at `/arm/link`. A page
//! attaches its robots, then sends one batch of sensor frames per bus tick,
//! and gets back the commands for the robots attached on that socket.
//!
//! With an upstream (the twin on the GPU machine), each page socket is relayed
//! to it frame for frame, since the twin speaks the same frames. Without one,
//! or while it cannot be reached, the bridge answers by holding still.

use std::{collections::HashSet, path::Path};

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message as Upstream};

use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
    routing::get,
};
use prost::Message as _;
use tower_http::services::ServeDir;

use crate::{
    brain,
    wire::{FromBridge, ToBridge, to_bridge},
};

/// `client` is the remote's build, `client/dist` in this repo. `upstream` is
/// the twin's socket, such as `ws://localhost:3300/arm/link` through the tunnel.
pub fn router(client: impl AsRef<Path>, upstream: Option<String>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route(
            "/arm/link",
            get(move |socket: WebSocketUpgrade| upgrade(socket, upstream.clone())),
        )
        .nest_service("/arm/client", ServeDir::new(client))
}

async fn upgrade(socket: WebSocketUpgrade, upstream: Option<String>) -> Response {
    socket.on_upgrade(move |socket| session(socket, upstream))
}

async fn session(socket: WebSocket, upstream: Option<String>) {
    if let Some(url) = upstream {
        match connect_async(url.as_str()).await {
            Ok((twin, _)) => return relay(socket, twin).await,
            Err(error) => eprintln!("the twin at {url} is unreachable ({error}); holding still"),
        }
    }

    hold(socket).await;
}

/// Passes every frame both ways until either side hangs up.
async fn relay<S>(page: WebSocket, twin: tokio_tungstenite::WebSocketStream<S>)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut to_page, mut from_page) = page.split();
    let (mut to_twin, mut from_twin) = twin.split();

    let up = async {
        while let Some(Ok(message)) = from_page.next().await {
            if let Message::Binary(bytes) = message
                && to_twin.send(Upstream::Binary(bytes)).await.is_err()
            {
                break;
            }
        }
    };
    let down = async {
        while let Some(Ok(message)) = from_twin.next().await {
            if let Upstream::Binary(bytes) = message
                && to_page.send(Message::Binary(bytes)).await.is_err()
            {
                break;
            }
        }
    };

    tokio::select! {
        _ = up => {}
        _ = down => {}
    }
}

/// Answers every attached robot by holding still.
async fn hold(mut socket: WebSocket) {
    let mut attached = HashSet::new();

    while let Some(Ok(message)) = socket.recv().await {
        let Message::Binary(bytes) = message else {
            continue;
        };
        let Ok(ToBridge {
            message: Some(message),
        }) = ToBridge::decode(bytes)
        else {
            eprintln!("dropped a frame that does not decode");
            continue;
        };

        match message {
            to_bridge::Message::Attach(attach) => {
                attached.insert(attach.id);
            }
            to_bridge::Message::Detach(detach) => {
                attached.remove(&detach.id);
            }
            to_bridge::Message::Sensors(batch) => {
                let commands: Vec<_> = batch
                    .frames
                    .iter()
                    .filter(|frame| attached.contains(&frame.id))
                    .filter_map(brain::answer)
                    .collect();

                if commands.is_empty() {
                    continue;
                }

                let reply = FromBridge { commands }.encode_to_vec();

                if socket.send(Message::Binary(reply.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}
