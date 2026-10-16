#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <workspace|spacetimedb> [base-sha]" >&2
  exit 2
}

scope="${1:-}"
base_sha="${2:-${RUSTFMT_BASE_SHA:-}}"

case "$scope" in
  workspace|spacetimedb) ;;
  *) usage ;;
esac

if [[ -z "$base_sha" || "$base_sha" =~ ^0+$ ]]; then
  echo "A non-zero base SHA is required for the changed-file rustfmt check." >&2
  exit 2
fi

if ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  echo "Rustfmt base commit is unavailable: $base_sha" >&2
  echo "Check out the repository with full history (fetch-depth: 0)." >&2
  exit 2
fi

if [[ "${GITHUB_EVENT_NAME:-}" == pull_request* ]]; then
  diff_range="${base_sha}...HEAD"
else
  diff_range="${base_sha}..HEAD"
fi

mapfile -d '' changed_files < <(
  git diff --name-only --diff-filter=ACMR -z "$diff_range" -- '*.rs'
)

rust_files=()
for file in "${changed_files[@]}"; do
  [[ -f "$file" ]] || continue

  case "$file" in
    vendor/*|.contracts-staging/*|target/*|*/target/*)
      continue
      ;;
    crates/stdb-client/src/generated_reducer_contract.rs|spacetimedb/src/generated_reconstruction_apply.rs)
      continue
      ;;
  esac

  case "$scope:$file" in
    workspace:api-server/*.rs|workspace:ai-gateway/*.rs|workspace:iot-gateway/*.rs|workspace:lumiere-codegen/*.rs|workspace:crates/stdb-config/*.rs|workspace:crates/stdb-client/*.rs|workspace:crates/stdb-auth/*.rs|workspace:crates/presentation-core/*.rs)
      rust_files+=("$file")
      ;;
    spacetimedb:spacetimedb/*.rs)
      rust_files+=("$file")
      ;;
  esac
done

if (( ${#rust_files[@]} == 0 )); then
  echo "rustfmt: no changed Rust files in $scope scope"
  exit 0
fi

printf 'rustfmt: checking %d changed Rust file(s) in %s scope\n' "${#rust_files[@]}" "$scope"
# Several changed files are module roots. Without skip_children, rustfmt follows
# their module declarations and starts checking unchanged siblings too.
rustfmt --edition 2021 --check --config skip_children=true "${rust_files[@]}"
