#!/usr/bin/env bash
# Builds fulgur_wasm_proto_bg.wasm + JS glue from ./crate (a copy of upstream
# fulgur-rs/fulgur crates/fulgur-wasm, which is not published, compiled against
# the published `fulgur` crate). Needs a Rust toolchain with the
# wasm32-unknown-unknown target and wasm-bindgen-cli matching Cargo.lock
# (0.2.130). About 2 minutes on this box.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/crate"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$here" \
    target/wasm32-unknown-unknown/release/fulgur_wasm_proto.wasm
rm -f "$here/fulgur_wasm_proto_bg.wasm.d.ts"
