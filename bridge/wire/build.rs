use std::path::PathBuf;

/// The schema is the one file the TypeScript and the Rust are both generated from.
fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../proto");
    let schema = root.join("kicl/arm/v1/arm.proto");

    unsafe { std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path().unwrap()) };
    println!("cargo:rerun-if-changed={}", schema.display());
    prost_build::compile_protos(&[schema], &[root]).expect("the wire's schema compiles");
}
