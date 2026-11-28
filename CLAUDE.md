# CLAUDE.md

Ki.CL-arm holds the wire between Ki.CL's factory-arm hub and its arms: the schema in `proto/`, the `arm` remote in `client/`, the development server in `server/` and the bridge in `bridge/`. README.md is the reference for how they fit and how to run them.

- The TypeScript in `client/` and `server/` follows the rules in `Ki.CL/CLAUDE.md`, "Code" included. The client imports itself as `arm/`, the name Ki.CL loads it under.
- The Rust in `bridge/` follows Rust's own conventions: `cargo fmt` with `bridge/rustfmt.toml`, and `cargo clippy`.
