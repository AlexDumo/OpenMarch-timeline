#!/bin/bash
# Runs a recording script inside the media image, on a virtual screen, with software GL.
#
#   scripts/media-kit/in-docker.sh scripts/docs-media/capture.mjs [args...]
#   scripts/media-kit/in-docker.sh scripts/whats-new-media/record.mjs timeline
#
# Run from apps/desktop after building the app. Builds the image (openmarch-media) the
# first time. Output lands in the repo as if the script ran on this machine.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(cd "$HERE/../.." && pwd)"
REPO="$(cd "$DESKTOP" && git rev-parse --show-toplevel)"
COMMON="$(cd "$DESKTOP" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
IMAGE=openmarch-media
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
    docker build -q -t "$IMAGE" "$HERE" >/dev/null
MOUNTS=(-v "$REPO:$REPO")
[ "$COMMON" != "$REPO" ] && MOUNTS+=(-v "$COMMON:$COMMON:ro")
[ -n "${DOCS_MEDIA_WORK:-}" ] && MOUNTS+=(-v "$DOCS_MEDIA_WORK:$DOCS_MEDIA_WORK") &&
    ENV_WORK=(-e "DOCS_MEDIA_WORK=$DOCS_MEDIA_WORK") || ENV_WORK=()
exec docker run --rm --init --shm-size=1g --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -e MEDIA_EXTRA_ARGS="${MEDIA_EXTRA_ARGS:-}" "${ENV_WORK[@]}" "${MOUNTS[@]}" -w "$DESKTOP" "$IMAGE" \
    xvfb-run -a -s "-screen 0 3840x2400x24" node "$@" --software-gl
