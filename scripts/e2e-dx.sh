#!/usr/bin/env bash
# Build helpers only; no service termination or database mutation.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${E2E_DX_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

# Root Cargo manifests consume the checksum-verified local contracts package.
if [ "${E2E_PREBUILT:-0}" != "1" ]; then
  "$ROOT/scripts/prepare-vendored-contracts-rust.sh" >/dev/null
fi

fingerprint() { python3 "$SCRIPT_DIR/build-fingerprint.py" "$1" --root "$ROOT"; }

api_binary() {
  if [ "${E2E_PREBUILT:-0}" = "1" ]; then
    printf '%s\n' "$ROOT/.ci/e2e-build/bin/api-server"
    return
  fi
  # Cargo metadata honors CARGO_TARGET_DIR and .cargo/config.toml. A configured
  # cross target is deliberately not supported by this native local runner.
  cargo metadata --no-deps --format-version 1 --locked |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"] + "/debug/api-server")'
}

storage_migrate_binary() {
  if [ "${E2E_PREBUILT:-0}" = "1" ]; then
    printf '%s\n' "$ROOT/.ci/e2e-build/bin/storage-migrate"
    return
  fi
  cargo metadata --no-deps --format-version 1 --locked |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"] + "/debug/storage-migrate")'
}

api_build() {
  if [ "${E2E_PREBUILT:-0}" = "1" ]; then
    [ -x "$(api_binary)" ] || { echo "[e2e] Missing prebuilt api-server." >&2; exit 1; }
    [ -x "$(storage_migrate_binary)" ] || { echo "[e2e] Missing prebuilt storage-migrate." >&2; exit 1; }
    echo "[e2e] Reusing verified prebuilt API binaries."
    return
  fi
  cargo build -p api-server --bin api-server --bin storage-migrate --locked
}

frontend_build() {
  local stamp="$ROOT/.tmp/e2e/frontend.hash" current build_id
  if [ "${E2E_PREBUILT:-0}" = "1" ]; then
    [ -s "$ROOT/frontend/web/.next/BUILD_ID" ] || {
      echo "[e2e] Missing prebuilt Next.js BUILD_ID." >&2
      exit 1
    }
    echo "[e2e] Reusing verified prebuilt Next.js application."
    return
  fi
  mkdir -p "$(dirname "$stamp")"
  current="$(fingerprint frontend)"
  build_id="$(cat "$ROOT/frontend/web/.next/BUILD_ID" 2>/dev/null || true)"
  if [ -z "${CI:-}" ] && [ "${E2E_FORCE_REBUILD:-0}" != 1 ] && [ -n "$build_id" ] &&
      [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$current:$build_id" ]; then
    echo "[e2e] Reusing matching local production frontend build."
    return
  fi
  # Invalidate before building: a failed attempt must not leave a reusable stamp.
  rm -f "$stamp"
  (cd "$ROOT/frontend/web" && pnpm exec next build)
  build_id="$(cat "$ROOT/frontend/web/.next/BUILD_ID")"
  [ -n "$build_id" ] || { echo "[e2e] Build completed without BUILD_ID" >&2; exit 1; }
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    local compiler_cache="$ROOT/frontend/web/.next/cache/turbopack"
    if [ ! -d "$compiler_cache" ] ||
        [ -z "$(find "$compiler_cache" -type f -size +0c -print -quit)" ]; then
      echo "[e2e] Build completed without a nonempty Turbopack compiler cache." >&2
      exit 1
    fi
  fi
  printf '%s:%s\n' "$current" "$build_id" > "$stamp"
}

case "${1:-}" in
  api-fingerprint) fingerprint api ;;
  frontend-fingerprint) fingerprint frontend ;;
  stdb-fingerprint) fingerprint stdb ;;
  api-build) api_build ;;
  api-binary) api_binary ;;
  api-run)
    binary="$(api_binary)"
    [ -x "$binary" ] || { echo "[e2e] Missing $binary; run api-build first." >&2; exit 1; }
    shift
    exec "$binary" "$@"
    ;;
  storage-migrate)
    binary="$(storage_migrate_binary)"
    [ -x "$binary" ] || { echo "[e2e] Missing $binary; run api-build first." >&2; exit 1; }
    shift
    exec "$binary" "$@"
    ;;
  frontend-build) frontend_build ;;
  *) echo "usage: $0 {api-fingerprint|frontend-fingerprint|stdb-fingerprint|api-build|api-binary|api-run|storage-migrate|frontend-build}" >&2; exit 2 ;;
esac
