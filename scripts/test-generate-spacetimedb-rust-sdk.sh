#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lumiere-rust-sdk-wrapper-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

FAKE_SPACETIME="$TMP_ROOT/spacetime"
cat >"$FAKE_SPACETIME" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail

out_dir=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--out-dir" ]]; then
    out_dir="$2"
    shift 2
  else
    shift
  fi
done

mkdir -p "$out_dir"
cat >"$out_dir/mod.rs" <<'RUST'
pub mod row;
RUST
cat >"$out_dir/row.rs" <<'RUST'
pub struct Row {
    pub type: String,
    pub ref: Option<String>,
}

impl Row {
    pub fn new() -> Self {
        Self {
            type: String::new(),
            ref: None,
        }
    }
}
RUST
printf '%s\n' 'error: expected identifier, found keyword `type`' >&2
printf '%s\n' 'error: expected identifier, found keyword `ref`' >&2
if [[ "${FAKE_UNEXPECTED:-}" == "1" ]]; then
  printf '%s\n' 'error: module compilation failed' >&2
fi
exit "${FAKE_EXIT_STATUS:-1}"
FAKE
chmod +x "$FAKE_SPACETIME"

SPACETIME_BIN="$FAKE_SPACETIME" \
  bash "$ROOT/scripts/generate-spacetimedb-rust-sdk.sh" "$TMP_ROOT/out" "$TMP_ROOT/module"

grep -q 'pub r#type:' "$TMP_ROOT/out/row.rs"
grep -q 'pub r#ref:' "$TMP_ROOT/out/row.rs"
grep -q 'r#type:' "$TMP_ROOT/out/row.rs"
grep -q 'r#ref:' "$TMP_ROOT/out/row.rs"

FAKE_EXIT_STATUS=0 SPACETIME_BIN="$FAKE_SPACETIME" \
  bash "$ROOT/scripts/generate-spacetimedb-rust-sdk.sh" "$TMP_ROOT/out-zero" "$TMP_ROOT/module"

grep -q 'pub r#type:' "$TMP_ROOT/out-zero/row.rs"
grep -q 'pub r#ref:' "$TMP_ROOT/out-zero/row.rs"

if FAKE_UNEXPECTED=1 FAKE_EXIT_STATUS=0 SPACETIME_BIN="$FAKE_SPACETIME" \
  bash "$ROOT/scripts/generate-spacetimedb-rust-sdk.sh" "$TMP_ROOT/rejected" "$TMP_ROOT/module" \
  >"$TMP_ROOT/unexpected.log" 2>&1; then
  echo "generator wrapper accepted an unrelated error from a zero exit" >&2
  exit 1
fi
grep -q 'error: module compilation failed' "$TMP_ROOT/unexpected.log"

if FAKE_UNEXPECTED=1 FAKE_EXIT_STATUS=1 SPACETIME_BIN="$FAKE_SPACETIME" \
  bash "$ROOT/scripts/generate-spacetimedb-rust-sdk.sh" "$TMP_ROOT/rejected-nonzero" "$TMP_ROOT/module" \
  >"$TMP_ROOT/unexpected-nonzero.log" 2>&1; then
  echo "generator wrapper accepted an unrelated error from a nonzero exit" >&2
  exit 1
fi
grep -q 'error: module compilation failed' "$TMP_ROOT/unexpected-nonzero.log"

echo "SpacetimeDB Rust SDK wrapper recovery test passed"
