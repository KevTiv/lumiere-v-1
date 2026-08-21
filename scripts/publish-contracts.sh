#!/usr/bin/env bash
# Publishes .contracts-staging/{bindings,manifests} to the lumiere-contracts
# repo as a new tagged release, and prints the Cargo.toml dependency line to
# bump in this repo.
#
# Prerequisites: `make generate-stdb-rust-sdk && make codegen` must have
# already populated .contracts-staging/. Run via `make publish-contracts`.
#
# Versioning: bump the schema axis (arg 1) when LumiereSchemaManifest.version
# changes; bump the contract axis (arg 2, this script's positional VERSION)
# for any released change. See docs/plans/contracts-extraction-execution-plan.md §4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="$ROOT/.contracts-staging"
CONTRACTS_REPO="${LUMIERE_CONTRACTS_REPO:-git@github.com:KevTiv/lumiere-contracts.git}"
VERSION="${1:?usage: publish-contracts.sh <version, e.g. 0.1.0>}"

if [[ ! -d "$STAGING/bindings" || ! -d "$STAGING/manifests" ]]; then
  echo "error: $STAGING/{bindings,manifests} missing — run make generate-stdb-rust-sdk && make codegen first" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$CONTRACTS_REPO" "$WORK/repo"
cd "$WORK/repo"

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
echo "Bump the pinned dependency in lumiere-v-1's root Cargo.toml:"
echo
echo "  lumiere-contracts = { git = \"ssh://git@github.com/KevTiv/lumiere-contracts.git\", tag = \"v$VERSION\" }"
