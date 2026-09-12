#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
deps_dir="$repo_dir/target/debug/deps"
serde_rlib=$(find "$deps_dir" -maxdepth 1 -name 'libserde_json-*.rlib' -print | sort | head -n 1)
if [ -z "$serde_rlib" ]; then
    echo "missing target/debug/deps/libserde_json-*.rlib; run the coordinator's dependency setup first" >&2
    exit 2
fi

test_bin=$(mktemp "${TMPDIR:-/tmp}/lumiere-build-rs-test.XXXXXX")
trap 'rm -f "$test_bin"' EXIT
rustc --edition=2021 --test "$repo_dir/api-server/build.rs" \
    --extern "serde_json=$serde_rlib" \
    -L "dependency=$deps_dir" \
    -o "$test_bin"
"$test_bin"
