use robot_bridge::link;

/// Loopback by default: on the GCP machine the bridge is reached through an
/// IAP tunnel, never from the open internet.
const LISTEN: &str = "127.0.0.1:3200";

/// The remote's build, from the crate's own folder.
const CLIENT: &str = "../client/dist";

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let address = std::env::var("BRIDGE_LISTEN").unwrap_or_else(|_| LISTEN.into());
    let client = std::env::var("BRIDGE_CLIENT").unwrap_or_else(|_| CLIENT.into());
    // The twin on the GPU machine; without it every robot on the link holds still.
    let upstream = std::env::var("BRIDGE_UPSTREAM")
        .ok()
        .filter(|url| !url.is_empty());
    let listener = tokio::net::TcpListener::bind(&address).await?;

    println!("bridge on ws://{address}/arm/link");
    match &upstream {
        Some(url) => println!("relaying to the twin at {url}"),
        None => println!("no twin: robots on the link hold still"),
    }
    axum::serve(listener, link::router(client, upstream))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
}
