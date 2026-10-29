#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve commit tags once, then promote only digests. Use anonymous pulls to
# match Railway's registry access, and verify every OCI revision before writes.
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1

task_docker_config="$(mktemp -d)"
trap 'rm -rf "$task_docker_config"' EXIT
repository="ghcr.io/${GITHUB_REPOSITORY,,}"
coordinates=""

for specification in \
  RUST_RUNTIME_IMAGE=rust-runtime \
  STDB_PUBLISHER_IMAGE=spacetimedb-publisher \
  CHROMIUM_IMAGE=chromium-worker \
  WEB_IMAGE=web \
  API_GATEWAY_IMAGE=api-gateway; do
  variable="${specification%%=*}"
  suffix="${specification#*=}"
  image="${!variable:-}"
  if [[ -z "$image" ]]; then
    digest="$(docker buildx imagetools inspect "$repository-$suffix:$RELEASE_SHA" \
      --format '{{json .Manifest}}' | jq -er '.digest')"
    image="$repository-$suffix@$digest"
  fi
  [[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || {
    echo "Invalid immutable image for $variable" >&2
    exit 1
  }
  DOCKER_CONFIG="$task_docker_config" docker pull --quiet "$image" >/dev/null
  image_revision="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  [[ "$image_revision" == "$RELEASE_SHA" ]] || {
    echo "$variable revision $image_revision does not match release $RELEASE_SHA" >&2
    exit 1
  }
  coordinates+="$variable=$image"$'\n'
done

# Export only after the complete release set has passed verification.
printf '%s' "$coordinates" >> "$GITHUB_ENV"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Verified release %s\n\n```text\n%s```\n' \
    "$RELEASE_SHA" "$coordinates" >> "$GITHUB_STEP_SUMMARY"
fi
