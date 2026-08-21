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
if [[ ! -f "$STAGING/ir/lumiere-contract-ir-v1.json" || ! -f "$STAGING/ir/lumiere-contract-ir-v1.json.sha256" ]]; then
  echo "error: canonical contract IR missing — run make codegen first" >&2
  exit 1
fi

python3 "$ROOT/scripts/verify-contract-ir.py" \
  "$STAGING/ir/lumiere-contract-ir-v1.json" --require-clean

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$CONTRACTS_REPO" "$WORK/repo"
cd "$WORK/repo"

# Immutable source handoff. Downstream emitters must eventually consume only
# this file selected by its sidecar digest; they must not inspect lumiere-v-1.
mkdir -p ir
cp "$STAGING/ir/lumiere-contract-ir-v1.json" ir/
cp "$STAGING/ir/lumiere-contract-ir-v1.json.sha256" ir/

rm -rf crates/lumiere-contracts/src/bindings
mkdir -p crates/lumiere-contracts/src/bindings
cp -R "$STAGING/bindings/." crates/lumiere-contracts/src/bindings/
rm -rf manifests
mkdir -p manifests
cp "$STAGING/manifests/"*.json manifests/
echo "$VERSION" > CONTRACT_VERSION

# lib.rs re-exports the generated bindings module tree and exposes each
# manifest as a &'static str const via include_str!.
{
  echo "//! Generated-only crate. Do not hand-edit."
  echo "//! Published from lumiere-v-1 by scripts/publish-contracts.sh."
  echo
  echo "pub mod bindings;"
  echo
  echo "pub mod manifests {"
  for f in manifests/*.json; do
    name="$(basename "$f" .json)"
    const_name="$(echo "$name" | tr 'a-z-' 'A-Z_')"
    echo "    pub const ${const_name}: &str = include_str!(\"../../../manifests/${name}.json\");"
  done
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

cargo build --manifest-path crates/lumiere-contracts/Cargo.toml

# TypeScript package: verbatim spacetime-generate output + lumiere-codegen
# TS/JSON artifacts. Kept at the exact same relative paths as they had in
# frontend/packages/stdb/src/generated, so nothing inside them needs an
# import rewrite — only consumers outside the tree change their specifier.
rm -rf packages/contracts/src
mkdir -p packages/contracts/src
cp -R "$STAGING/ts/generated" packages/contracts/src/generated
cp "$STAGING/ts/stdb-generated-sql-columns.json" packages/contracts/src/
cp "$STAGING/ts/stdb-reducer-invalidation.ts" packages/contracts/src/

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

  # Type-checking above reads the raw .ts source directly (package.json's
  # "types" export condition) — no build needed for that. But a real
  # installed dependency (unlike a pnpm workspace symlink, which resolves
  # outside node_modules) sits physically inside node_modules, and several
  # real consumers refuse to execute raw .ts there: Node's own native
  # type-stripping explicitly excludes node_modules, and bundlers that
  # don't have this package in their transpile allowlist expect valid JS.
  # esbuild bundles each entry point into self-contained ESM, inlining the
  # ~1700 extensionless-relative-import generated files so Node ESM's
  # stricter resolution rules never see them. `spacetimedb` stays external
  # since it's a real runtime dependency, not generated content.
  rm -rf dist
  node -e '
    const esbuild = require("esbuild");
    const entries = [
      "generated/index.ts",
      "generated/types.ts",
      "generated/types/reducers.ts",
      "generated/types/procedures.ts",
      "generated/query-registry.ts",
      "generated/role_table.ts",
      "generated/user_organization_table.ts",
      "generated/user_profile_table.ts",
      "generated/user_role_assignment_table.ts",
      "stdb-reducer-invalidation.ts",
    ];
    esbuild.buildSync({
      entryPoints: entries.map((e) => `src/${e}`),
      outbase: "src",
      outdir: "dist",
      bundle: true,
      format: "esm",
      platform: "neutral",
      external: ["spacetimedb"],
      logLevel: "warning",
    });
  '
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
