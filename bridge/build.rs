// The wire types, generated from the schema the page uses. protox compiles it
// in Rust, so building the bridge needs no protoc.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schema = "../proto/kicl/robot/v1/robot.proto";
    let files = protox::compile([schema], ["../proto"])?;

    prost_build::Config::new().compile_fds(files)?;
    println!("cargo:rerun-if-changed={schema}");

    Ok(())
}
