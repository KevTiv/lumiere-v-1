#!/usr/bin/env bash
# SpacetimeDB Rust client codegen may emit invalid Rust for columns named Rust
# keywords (e.g. `type`, `ref`). Run after: spacetime generate --lang rust ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-$ROOT/.contracts-staging/bindings}"
if [[ ! -d "$DIR" ]]; then
  echo "missing $DIR" >&2
  exit 1
fi
find "$DIR" -name '*.rs' -print0 | xargs -0 perl -pi -e '
  # A raw identifier preserves the original column name for generated codecs.
  # `self`, `Self`, `super`, and `crate` cannot be raw identifiers and require
  # generator support if they are ever used as column names.
  my $keyword = qr/
    as|async|await|break|const|continue|dyn|else|enum|extern|false|fn|for|gen|if|impl|in|
    let|loop|match|mod|move|mut|pub|ref|return|static|struct|trait|true|type|union|unsafe|use|
    where|while|abstract|become|box|do|final|macro|override|priv|try|typeof|unsized|virtual|yield
  /x;
  s/^(\s*pub\s+)($keyword)(\s*:)/${1}r#${2}${3}/gm;
  s/^(\s*)($keyword)(\s*:)/${1}r#${2}${3}/gm;
'

echo "escaped Rust keyword fields in $DIR"
