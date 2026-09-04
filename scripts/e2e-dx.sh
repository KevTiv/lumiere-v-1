#!/usr/bin/env bash
# Build helpers only; no service termination or database mutation.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${E2E_DX_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

fingerprint() { python3 "$SCRIPT_DIR/build-fingerprint.py" "$1" --root "$ROOT"; }

api_binary() {
  # Cargo metadata honors CARGO_TARGET_DIR and .cargo/config.toml. A configured
  # cross target is deliberately not supported by this native local runner.
  cargo metadata --no-deps --format-version 1 --locked |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"] + "/debug/api-server")'
}

api_build() { cargo build -p api-server --bin api-server --locked; }

frontend_build() {
  local stamp="$ROOT/.tmp/e2e/frontend.hash" current build_id
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
  frontend-build) frontend_build ;;
  *) echo "usage: $0 {api-fingerprint|frontend-fingerprint|stdb-fingerprint|api-build|api-binary|api-run|frontend-build}" >&2; exit 2 ;;
esac
