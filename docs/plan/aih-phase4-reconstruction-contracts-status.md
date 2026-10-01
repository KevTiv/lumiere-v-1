# Phase 4 reconstruction contract alignment

Status: prerequisite source implemented; matching release/pin pending; live AG-09 acceptance pending.

## Scope

Stacked on `codex/aih-phase4-draft-protocol-recovery` (#135). Carries the existing ERP keyed-return prerequisite from `3a1c42dfa8ede6d6803281d0c4b6e9f776988251`, including its owner-layer replay test, resource and storage policies, tenancy census and generated restore application. It does not import the wider ERP workflow stack.

The existing `release-contracts.yml` workflow regenerates from this coherent source, publishes a fresh immutable tag only after candidate preparation, updates every Rust/TypeScript consumer and lockfile, and checks drift. The migration catalog checksum is recomputed with the runtime checksum function after updating the pin. No manifest comparison is bypassed.

## Evidence and correction

The September 30 release job for #135 (`36783133274`) generated 503 schema tables and correctly found no semantic drift from v0.3.60. The 504th table, `return_order_creation`, belonged to the separate ERP workflow stack; it was already present in published contracts by v0.3.74. Changing #135's version alone would therefore pair different source and contract shapes.

The old counts described schema tables, not restore tables: v0.3.60 has 503 schema tables, 498 restored and 5 recreated; the keyed-return schema has 504 tables, 499 restored and 5 recreated.

## Validation executed here

- Ownership, C2 coverage and AI reconstruction Python suites: 21 passed.
- HTTP parameter serialization suite: 38 passed, including keyed and legacy return Option encoding. Executed through Node 24 native TypeScript stripping with only the test import resolved to its absolute source path.
- C2 source coverage verifier passed; workflow YAML parsed; relevant shell syntax and whitespace checks passed.
- C8 descriptor comparison awaits authoritative regeneration in the release job.
- Six release-manifest tests could not start because this environment has no Cargo-resolved contracts checkout. Rust, SpacetimeDB and PostgreSQL executables are unavailable here.

## Local completion gate

1. Confirm the release job has published and committed the matching pin, then check out that final commit. Do not reuse staging, WASM or binaries from a different ERP branch.
2. Regenerate live staging and run `make check-contracts-drift`; verify 504 schema tables and 499 restored tables in the pinned manifest. Rebuild both C7 binaries and the disposable source/target modules from this commit.
3. Populate all nine AI tables plus foreign-organization rows in `lumiere-c7-ai-source`, then freeze the source. Capture a new real coverage watermark; do not reuse the previous 1,744-row report after changing source/schema.
4. Run `scripts/c7-all-module-reconstruction-drill.sh <organization-id>` with the documented dedicated source/reconstructor identities, loopback placement, PostgreSQL and `C7_EVIDENCE_DIR`. Preserve real verified `coverage.json`, `resume.json` and `repeat.json`.
5. Capture external provider-dispatch counters across restoration and controlled recovery probes in `ai-provider-dispatch.json`; run `scripts/verify-ai-harness-reconstruction.py`. Compare every scoped row, budget and request binding, unknown outcomes, pending approvals and succeeded-output integrity. Require no provider redispatch.

AG-09 remains partial until the actual reconstruction, repeat and provider-observation evidence passes. This is a fresh/disposable database drill; it does not certify migration of an already-deployed PostgreSQL database.
