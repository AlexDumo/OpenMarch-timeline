#!/bin/bash
# cspell:words meshoptimizer meshoptimizer's ndarray premultiplying SCEN tris khronos meshopt webp
# go.sh <mode> : runs run.mjs in the openmarch-e2e container with the GPU
set -u
REPO=/home/alex/worktrees/t3/OpenMarch/t3-c6d3e22c-eadd6f2f7d457362
OUT=/mnt/data/spike-995-harness/out; mkdir -p $OUT
SCEN_DIR=/mnt/data/spike-995-harness
source ~/om-capture/lib/common.sh
NO_BUILD=1
run_container_pw() {
  local common; common="$(cd "$REPO" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
  docker run --rm --init --shm-size=1g --user "$(id -u):$(id -g)" -e HOME=/tmp $(gpu_args) \
    -e OUT=/out -e RES=1600x1000 -e RECORD=0 -e PLAYWRIGHT_BROWSERS_PATH=/pw \
    -v "$REPO:$REPO" -v "$common:$common" -v "$OUT:/out" -v "$SCEN_DIR:/scenario:ro" -v "$HOME/om-capture/lib:/harness:ro" -v "$HOME/.cache/ms-playwright:/pw:ro" \
    -w "$REPO/apps/desktop" $IMAGE timeout 900 bash /harness/inner.sh "$@"
}
run_container_pw node /scenario/run.mjs "$1"
