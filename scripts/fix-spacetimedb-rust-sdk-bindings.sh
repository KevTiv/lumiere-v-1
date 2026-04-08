#!/usr/bin/env bash
# SpacetimeDB 2.0.1 Rust client codegen can emit invalid Rust for columns named
# Rust keywords (e.g. `type`, `ref`). Run after: spacetime generate --lang rust ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/api-server/src/stdb_sdk_bindings"
if [[ ! -d "$DIR" ]]; then
  echo "missing $DIR" >&2
  exit 1
fi
find "$DIR" -name '*.rs' -print0 | xargs -0 perl -pi -e '
  s/pub type:/pub r#type:/g;
  s/pub ref:/pub r#ref:/g;
  s/^(\s+)type: (__sdk)/$1r#type: $2/gm;
  s/^(\s+)ref: (__sdk)/$1r#ref: $2/gm;
'
echo "fixed Rust keywords in $DIR"
