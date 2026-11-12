#!/usr/bin/env bash
set -Eeuo pipefail

# Verify the payload, not just a source tag: deployment-owned policy changes
# the WASM even when its source revision is unchanged.
[[ $# -eq 3 ]] || { echo "usage: verify-stdb-publisher-image.sh IMAGE WASM SOURCE_SHA" >&2; exit 1; }
image="$1"
module="$2"
revision="$3"
[[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ && "$revision" =~ ^[0-9a-f]{40}$ && -s "$module" ]] || {
  echo "Publisher verification requires an immutable image, module and source revision" >&2
  exit 1
}
read -r expected _ < <(sha256sum "$module")
docker pull --quiet "$image" >/dev/null
observed_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
observed_module="$(docker image inspect --format '{{ index .Config.Labels "io.lumiere.spacetimedb.module-sha256" }}' "$image")"
[[ "$observed_revision" == "$revision" && "$observed_module" == "$expected" ]] || {
  echo "Publisher source/module mismatch; do not reuse or retag this image. Publish a new tested source revision." >&2
  exit 1
}
temporary="$(mktemp -d)"
container=""
cleanup() {
  if [[ -n "$container" ]]; then docker rm --volumes "$container" >/dev/null; fi
  rm -rf "$temporary"
}
trap cleanup EXIT
# Never execute code supplied by the image being verified, including its own
# checksum executable. Copy from a stopped container and hash on the runner.
container="$(docker create --network none --entrypoint /bin/true "$image")"
docker cp "$container:/app/spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm" "$temporary/module.wasm"
[[ -f "$temporary/module.wasm" && ! -L "$temporary/module.wasm" ]] || {
  echo "Publisher WASM payload must be a regular file, not a link or directory" >&2
  exit 1
}
read -r actual _ < <(sha256sum "$temporary/module.wasm")
[[ "$actual" == "$expected" ]] || {
  echo "Publisher WASM payload differs from the reviewed compiled module" >&2
  exit 1
}
echo "Verified publisher revision and compiled module payload"
