#!/usr/bin/env bash
# Transitional publisher. It publishes the canonical, checksummed IR handoff
# plus the current bindings/manifests/TS outputs under one tag. Target-specific
# emission moves to lumiere-contracts next; once that repository can regenerate
# every package from IR alone, remove the direct output-copying sections below.
#
# Prerequisites: `make generate-stdb-rust-sdk && make generate-stdb-ts-sdk &&
# make codegen` must have already populated .contracts-staging/. Run via
# `make publish-contracts VERSION=x.y.z`.
#
# Versioning: bump the schema axis (LumiereSchemaManifest.version) when the
# serialized IR shape changes; bump the contract axis (this script's VERSION
# arg) for any released change. See
# docs/plans/contracts-extraction-execution-plan.md §4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="$ROOT/.contracts-staging"
CONTRACTS_REPO="${LUMIERE_CONTRACTS_REPO:-git@github.com:KevTiv/lumiere-contracts.git}"
VERSION="${1:?usage: publish-contracts.sh <version, e.g. 0.1.0>}"
if [[ ! -d "$STAGING/bindings" || ! -d "$STAGING/manifests" ]]; then
  echo "error: $STAGING/{bindings,manifests} missing — run make generate-stdb-rust-sdk && make codegen first" >&2
  exit 1
fi
if [[ ! -d "$STAGING/ts/generated" ]]; then
  echo "error: $STAGING/ts/generated missing — run make generate-stdb-ts-sdk && make codegen first" >&2
  exit 1
fi
if [[ ! -f "$STAGING/ir/lumiere-contract-ir-v2.json" \
  || ! -f "$STAGING/ir/lumiere-contract-ir-v2.json.sha256" ]]; then
  echo "error: canonical contract IR v2 artifact missing — run make codegen first" >&2
  exit 1
fi

python3 "$ROOT/scripts/verify-contract-ir.py" \
  "$STAGING/ir/lumiere-contract-ir-v2.json" --require-clean

SOURCE_REPO="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
if [[ -z "$SOURCE_REPO" ]]; then
  SOURCE_REPO="$(git -C "$ROOT" rev-parse --show-toplevel)"
fi
readarray -t IR_METADATA < <(python3 - "$STAGING/ir/lumiere-contract-ir-v2.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    ir = json.load(source)
print(ir["source_commit"])
print(ir["ir_version"])
print(ir["schema_hash"])
print(__import__("hashlib").sha256(open(sys.argv[1], "rb").read()).hexdigest())
PY
)
SOURCE_COMMIT="${IR_METADATA[0]}"
IR_VERSION="${IR_METADATA[1]}"
SCHEMA_HASH="${IR_METADATA[2]}"
IR_SHA256="${IR_METADATA[3]}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$CONTRACTS_REPO" "$WORK/repo"
cd "$WORK/repo"

# Immutable source handoff. Downstream emitters must eventually consume only
# this file selected by its sidecar digest; they must not inspect lumiere-v-1.
mkdir -p ir
rm -f ir/lumiere-contract-ir-v1.json ir/lumiere-contract-ir-v1.json.sha256 ir/PIN-v1.json
cp "$STAGING/ir/lumiere-contract-ir-v2.json" ir/
cp "$STAGING/ir/lumiere-contract-ir-v2.json.sha256" ir/

# Keep one immutable provenance pin per IR generation. `PIN.json` is only the
# active-generation pointer consumed by downstream emitters. The source commit
# comes from each IR itself so a pin cannot accidentally describe a different
# checkout than the artifact that produced it.
python3 - "$SOURCE_REPO" "$SOURCE_COMMIT" "$IR_SHA256" "$IR_VERSION" "$SCHEMA_HASH" <<'PY'
import json
import sys
from pathlib import Path

def write_pin(path, source_commit, artifact_sha256, ir_version, schema_hash, artifact_name):
    Path(path).write_text(
        json.dumps(
            {
                "artifact_sha256": artifact_sha256,
                "ir_version": int(ir_version),
                "path": f"ir/{artifact_name}",
                "schema_hash": schema_hash,
                "source_commit": source_commit,
                "source_repository": sys.argv[1],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

write_pin(
    "ir/PIN-v2.json", sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5],
    "lumiere-contract-ir-v2.json",
)
Path("ir/PIN.json").write_text(Path("ir/PIN-v2.json").read_text(encoding="utf-8"), encoding="utf-8")
PY

rm -rf crates/lumiere-contracts/src/bindings
mkdir -p crates/lumiere-contracts/src/bindings
cp -R "$STAGING/bindings/." crates/lumiere-contracts/src/bindings/
rm -rf manifests
mkdir -p manifests
cp -R "$STAGING/manifests/." manifests/
# These two descriptors are companion-generated from the canonical IR. Never
# let copies inherited from pinned staging masquerade as publisher inputs.
rm -f manifests/application-operations.json manifests/resource-registry.json
echo "$VERSION" > CONTRACT_VERSION

# Restore contracts-owned manifests before the Rust crate enumerates them.
python3 scripts/generate-from-ir.py

# lib.rs re-exports the generated bindings module tree and exposes each
# manifest as a &'static str const via include_str!.
{
  echo "//! Generated-only crate. Do not hand-edit."
  echo "//! Published from lumiere-v-1 by scripts/publish-contracts.sh."
  echo
  echo '#[cfg(feature = "bindings")]'
  echo "pub mod bindings;"
  echo
  echo "/// Compact canonical descriptors generated from the IR v2 pin."
  echo '#[cfg(feature = "v2")]'
  echo "pub mod generated;"
  echo
  echo "pub mod manifests {"
  while IFS= read -r f; do
    rel="${f#manifests/}"
    name="${rel%.json}"
    name="${name%.sql}"
    const_name="$(echo "$name" | tr 'a-z/.-' 'A-Z____')"
    echo "    pub const ${const_name}: &str = include_str!(\"../../../manifests/${rel}\");"
  done < <(find manifests -type f \( -name '*.json' -o -name '*.sql' \) | LC_ALL=C sort)
  echo "}"
} > crates/lumiere-contracts/src/lib.rs

if [[ ! -f crates/lumiere-contracts/src/bindings/mod.rs ]]; then
  {
    for f in crates/lumiere-contracts/src/bindings/*.rs; do
      [[ "$(basename "$f")" == "mod.rs" ]] && continue
      echo "pub mod $(basename "$f" .rs);"
    done
  } > crates/lumiere-contracts/src/bindings/mod.rs
fi

sed -i.bak "s/^version = .*/version = \"$VERSION\"/" crates/lumiere-contracts/Cargo.toml
rm -f crates/lumiere-contracts/Cargo.toml.bak

# The generated Rust package manifest is contract-owned. Reassert its feature
# surface on every release so a drifted companion main branch cannot silently
# drop the bindings/v2 API required by pinned consumers.
python3 - <<'PY'
from pathlib import Path

path = Path("crates/lumiere-contracts/Cargo.toml")
package = path.read_text(encoding="utf-8").split("[features]", 1)[0]
package = package.split("[dependencies]", 1)[0].rstrip()
path.write_text(
    package
    + f'''\n\n[features]
default = ["bindings"]
bindings = ["dep:spacetimedb-sdk"]
v2 = []

[dependencies]
spacetimedb-sdk = {{ version = "=2.8.2", optional = true }}
serde_json = "1.0"
''',
    encoding="utf-8",
)
PY

CARGO_INCREMENTAL=0 cargo build --manifest-path crates/lumiere-contracts/Cargo.toml

# TypeScript package: verbatim spacetime-generate output + lumiere-codegen
# TS/JSON artifacts. Kept at the exact same relative paths as they had in
# frontend/packages/stdb/src/generated, so nothing inside them needs an
# import rewrite — only consumers outside the tree change their specifier.
# Keep the contracts-owned package entrypoints, tests, and generator support
# files intact; only refresh the generated subtree and generated sidecars.
rm -rf packages/contracts/src/generated
cp -R "$STAGING/ts/generated" packages/contracts/src/generated
cp "$STAGING/ts/stdb-generated-sql-columns.json" packages/contracts/src/
cp "$STAGING/ts/stdb-reducer-invalidation.ts" packages/contracts/src/

# The contracts repository owns IR-derived targets. Run its generator after
# the immutable input has been copied so these targets are present even when
# the application staging directory was produced by an older codegen pass.
python3 scripts/generate-from-ir.py

for generated in query-registry.ts operation-inputs.ts operation-descriptors.ts; do
  if [[ ! -f "packages/contracts/src/generated/$generated" ]]; then
    echo "error: contracts generator did not emit packages/contracts/src/generated/$generated" >&2
    exit 1
  fi
done

node -e '
  const fs = require("fs");
  const p = "packages/contracts/package.json";
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.version = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
' "$VERSION"

(
  cd packages/contracts
  npm install --no-save --silent
  ./node_modules/.bin/tsc --noEmit -p tsconfig.json

  # Let the package own its build graph and entrypoints; keeping this here
  # avoids a stale publisher-side list as generated targets are added.
  npm run build
)

git add -A
if git diff --cached --quiet; then
  echo "publish-contracts: no changes to publish"
  exit 0
fi
git -c user.name="lumiere-codegen" -c user.email="codegen@lumiere.local" \
  commit --quiet -m "chore: publish generated contracts v$VERSION"
git push --quiet origin main
git tag -a "v$VERSION" -m "Generated contracts release v$VERSION"
git push --quiet origin "v$VERSION"

echo
echo "Published lumiere-contracts v$VERSION."
echo "Bump the pinned dependencies in lumiere-v-1:"
echo
echo "  Cargo.toml:"
echo "  lumiere-contracts = { git = \"ssh://git@github.com/KevTiv/lumiere-contracts.git\", tag = \"v$VERSION\" }"
echo
echo "  frontend package.json (wherever @lumiere/contracts is a dependency):"
echo "  \"@lumiere/contracts\": \"github:KevTiv/lumiere-contracts#v$VERSION&path:packages/contracts\""
