# Phase 4 reconstruction contract alignment

Status: integrated with current main and contracts v0.3.139; live AG-09 acceptance pending (2026-10-23).

## Scope

Stacked on `codex/aih-phase4-draft-protocol-recovery` (#135), now integrated with current main. The keyed-return source prerequisite is already present on main, so this follow-up retains its Option serialization regression and the live reconstruction gate. It preserves the current immutable contracts v0.3.139 rather than repinning an older candidate.

The existing `release-contracts.yml` workflow regenerates from this coherent source, publishes a fresh immutable tag only after candidate preparation, updates every Rust/TypeScript consumer and lockfile, and checks drift. The migration catalog checksum is recomputed with the runtime checksum function after updating the pin. No manifest comparison is bypassed.

## Evidence and correction

The September 30 release job for #135 (`36783133274`) generated 503 schema tables and correctly found no semantic drift from v0.3.60. The 504th table, `return_order_creation`, belonged to the separate ERP workflow stack; it was already present in published contracts by v0.3.74. Changing #135's version alone would therefore pair different source and contract shapes.

The old counts described schema tables, not restore tables: v0.3.60 has 503 schema tables, 498 restored and 5 recreated; the keyed-return schema has 504 tables, 499 restored and 5 recreated.

## Historical validation before integration

- Ownership, C2 coverage and AI reconstruction Python suites: 21 passed.
- HTTP parameter serialization suite: 38 passed, including keyed and legacy return Option encoding. Executed through Node 24 native TypeScript stripping with only the test import resolved to its absolute source path.
- C2 source coverage verifier passed; workflow YAML parsed; relevant shell syntax and whitespace checks passed.
- C8 descriptor comparison awaits authoritative regeneration in the release job.
- Six release-manifest tests could not start because this environment has no Cargo-resolved contracts checkout. Rust, SpacetimeDB and PostgreSQL executables are unavailable here.

## Local completion gate

1. Check out the final integrated commit and verify its immutable contract pin. The historical v0.3.75 publication request is superseded by the existing v0.3.139 pin; publish a new version only if authoritative drift validation requires it. Do not reuse staging, WASM or binaries from another branch.
2. Regenerate live staging and run `make check-contracts-drift`; derive schema and restored-table counts from the final pinned manifest, not the historical 504/499 fixture. Rebuild both C7 binaries and disposable source/target modules from this commit.
3. Populate all nine AI tables plus foreign-organization rows in `lumiere-c7-ai-source`, then freeze the source. Capture a new real coverage watermark; do not reuse the previous 1,744-row report after changing source/schema.
4. Run `scripts/c7-all-module-reconstruction-drill.sh <organization-id>` with the documented dedicated source/reconstructor identities, loopback placement, PostgreSQL and `C7_EVIDENCE_DIR`. Preserve real verified `coverage.json`, `resume.json` and `repeat.json`.
5. Capture external provider-dispatch counters across restoration and controlled recovery probes in `ai-provider-dispatch.json`; run `scripts/verify-ai-harness-reconstruction.py`. Compare every scoped row, budget and request binding, unknown outcomes, pending approvals and succeeded-output integrity. Require no provider redispatch.

AG-09 remains partial until the actual reconstruction, repeat and provider-observation evidence passes. This is a fresh/disposable database drill; it does not certify migration of an already-deployed PostgreSQL database.

## Current operational prerequisites

The owner confirmed that the harness has no configured Mistral or other provider connection, and the Railway deployment is down. Normal gateway/browser acceptance and a real-provider pilot need a working runtime plus model profiles, routing policies, budgets/prices, service grants and a certified skill release. A provider key alone does not provision these records; use the sequence in [Mistral harness readiness](../plans/mistral-harness-readiness.md#credential-and-configuration-handoff).

Disposable database races, reconstruction and the instrumented restart probe can run on an independent local stack without a live Mistral account. Their dispatch counters must observe the actual test execution. These checks do not establish real-provider connectivity or complete the normal gateway/browser acceptance gate.
