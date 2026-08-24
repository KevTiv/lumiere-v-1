#!/usr/bin/env bash
# Prints the local filesystem path of the pinned lumiere-contracts git
# dependency's checkout root (the directory containing manifests/ and
# crates/lumiere-contracts/), or exits non-zero with a message on stderr.
#
# Requires the dependency to already be resolved/fetched — run `cargo fetch`
# or any `cargo check`/`cargo build` first if this is a fresh checkout.
set -euo pipefail

cargo metadata --format-version 1 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
pkgs = [p for p in d["packages"] if p["name"] == "lumiere-contracts"]
if not pkgs:
    print("lumiere-contracts not found in cargo metadata", file=sys.stderr)
    sys.exit(1)
manifest_path = pkgs[0]["manifest_path"]
# manifest_path = <checkout_root>/crates/lumiere-contracts/Cargo.toml
checkout_root = manifest_path.rsplit("/", 3)[0]
print(checkout_root)
'
