# The bridge for the machine: built from proto/ and bridge/ in a Rust image,
# run in a small one. Build from the repo root: docker build -f bridge/Dockerfile .
FROM rust:1.98-bookworm AS build
WORKDIR /src
COPY proto proto
COPY bridge bridge
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/bridge/target \
    cd bridge && cargo build --release -p arm-bridge && cp target/release/arm-bridge /arm-bridge

FROM debian:bookworm-slim
COPY --from=build /arm-bridge /usr/local/bin/arm-bridge
EXPOSE 3200
ENTRYPOINT ["arm-bridge"]
