#!/usr/bin/env bash
# Package and verify exact-commit build outputs shared by E2E matrix jobs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${E2E_CI_ARTIFACT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ARCHIVE="${E2E_CI_ARTIFACT_ARCHIVE:-$ROOT/.ci/e2e-build.tar.gz}"
ARTIFACT_DIR="$ROOT/.ci/e2e-build"
MANIFEST="$ARTIFACT_DIR/manifest.env"
CHECKSUMS="$ARTIFACT_DIR/SHA256SUMS"
WASM_REL="spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm"
NEXT_REL="frontend/web/.next"
PACK_STAGING=""

expected_sha() {
  local value="${1:-${E2E_ARTIFACT_EXPECTED_SHA:-${GITHUB_SHA:-}}}"
  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    echo "e2e-ci-artifact: expected a 40-character lowercase Git SHA" >&2
    exit 2
  fi
  printf '%s\n' "$value"
}

require_file() {
  if [ ! -f "$ROOT/$1" ]; then
    echo "e2e-ci-artifact: missing $1" >&2
    exit 1
  fi
}

require_archive() {
  if [ ! -f "$ARCHIVE" ]; then
    echo "e2e-ci-artifact: missing archive $ARCHIVE" >&2
    exit 1
  fi
}

verify() {
  local sha
  sha="$(expected_sha "${1:-}")"
  require_file ".ci/e2e-build/manifest.env"
  require_file ".ci/e2e-build/SHA256SUMS"
  require_file "$WASM_REL"
  require_file ".ci/e2e-build/bin/api-server"
  require_file ".ci/e2e-build/bin/storage-migrate"
  require_file "$NEXT_REL/BUILD_ID"

  (
    cd "$ROOT"
    sha256sum --quiet --check "$CHECKSUMS"
  )
  grep -Fxq 'E2E_ARTIFACT_FORMAT=1' "$MANIFEST"
  grep -Fxq "E2E_ARTIFACT_GIT_SHA=$sha" "$MANIFEST"
  grep -Fxq 'E2E_ARTIFACT_DEV_REDUCERS=1' "$MANIFEST"
  test -x "$ARTIFACT_DIR/bin/api-server"
  test -x "$ARTIFACT_DIR/bin/storage-migrate"
  echo "[e2e] Verified prebuilt artifact for $sha."
}

pack() {
  local sha staging
  sha="$(expected_sha "${1:-}")"
  require_file "$WASM_REL"
  require_file "target/debug/api-server"
  require_file "target/debug/storage-migrate"
  require_file "$NEXT_REL/BUILD_ID"

  staging="$(mktemp -d "${TMPDIR:-/tmp}/lumiere-e2e-artifact.XXXXXX")"
  PACK_STAGING="$staging"
  trap 'rm -rf "$PACK_STAGING"' EXIT
  mkdir -p \
    "$staging/.ci/e2e-build/bin" \
    "$staging/spacetimedb/target/wasm32-unknown-unknown/release" \
    "$staging/frontend/web"
  install -m 0755 "$ROOT/target/debug/api-server" "$staging/.ci/e2e-build/bin/api-server"
  install -m 0755 "$ROOT/target/debug/storage-migrate" "$staging/.ci/e2e-build/bin/storage-migrate"
  install -m 0644 "$ROOT/$WASM_REL" "$staging/$WASM_REL"
  cp -a "$ROOT/$NEXT_REL" "$staging/frontend/web/.next"
  rm -rf "$staging/frontend/web/.next/cache"

  cat > "$staging/.ci/e2e-build/manifest.env" <<EOF
E2E_ARTIFACT_FORMAT=1
E2E_ARTIFACT_GIT_SHA=$sha
E2E_ARTIFACT_DEV_REDUCERS=1
E2E_ARTIFACT_STDB_MODULE=lumiere-v1-local-e2e
E2E_ARTIFACT_STDB_HOST=http://127.0.0.1:3000
E2E_ARTIFACT_API_PORT=8082
E2E_ARTIFACT_WEB_PORT=3100
EOF
  (
    cd "$staging"
    find . -type f ! -path './.ci/e2e-build/SHA256SUMS' -print |
      LC_ALL=C sort |
      while IFS= read -r file; do sha256sum "$file"; done > .ci/e2e-build/SHA256SUMS
  )
  mkdir -p "$(dirname "$ARCHIVE")"
  rm -f "$ARCHIVE"
  tar -C "$staging" -czf "$ARCHIVE" .
  rm -rf "$staging"
  PACK_STAGING=""
  trap - EXIT
  echo "[e2e] Packaged exact-commit build artifact for $sha."
}

verify_archive() (
  local sha staging
  sha="$(expected_sha "${1:-}")"
  require_archive
  staging="$(mktemp -d "${TMPDIR:-/tmp}/lumiere-e2e-verify.XXXXXX")"
  trap 'rm -rf "$staging"' EXIT

  # Check the shipped files without replacing the builder's .next output: the
  # archive omits compiler caches that must survive for the cache-save step.
  tar -C "$staging" -xzf "$ARCHIVE"
  E2E_CI_ARTIFACT_ROOT="$staging" "$SCRIPT_DIR/e2e-ci-artifact.sh" verify "$sha"
)

install_artifact() {
  local sha
  sha="$(expected_sha "${1:-}")"
  if [ "${CI:-}" != "true" ]; then
    echo "e2e-ci-artifact: install is restricted to CI workspaces" >&2
    exit 2
  fi
  require_archive
  rm -rf "$ARTIFACT_DIR" "$ROOT/$NEXT_REL"
  rm -f "$ROOT/$WASM_REL"
  tar -C "$ROOT" -xzf "$ARCHIVE"
  verify "$sha"
}

case "${1:-}" in
  pack) pack "${2:-}" ;;
  install) install_artifact "${2:-}" ;;
  verify) verify "${2:-}" ;;
  verify-archive) verify_archive "${2:-}" ;;
  *)
    echo "usage: $0 {pack|install|verify|verify-archive} [git-sha]" >&2
    exit 2
    ;;
esac
