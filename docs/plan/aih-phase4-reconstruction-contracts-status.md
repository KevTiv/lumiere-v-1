# Phase 4 reconstruction contract alignment

Status: integrated with current main and contracts v0.3.139; disposable C7 runtime drill verified, normal gateway/provider acceptance and admission review pending (2026-10-23).

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

The actual disposable reconstruction, repeat and provider-observation drill now passes; its [evidence bundle](../evidence/aih-phase4-disposable-2026-10-23.json) records the source-component hashes, immutable pin, scoped watermark, complete-row checksums and observed dispatch counters. All 509 restore tables and six recreated tables verified in both runs. The nine AI tables match completely, with 37 foreign-organization source rows excluded and the instrumented dispatch counter held at one through restored-target recovery. Broader normal gateway/browser acceptance and admission review remain pending. This fresh/disposable database drill does not certify migration of an already-deployed PostgreSQL database.

## Current operational prerequisites

The owner confirmed that the harness has no configured Mistral or other provider connection, and the Railway deployment is down. Normal gateway/browser acceptance and a real-provider pilot need a working runtime plus model profiles, routing policies, budgets/prices, service grants and a certified skill release. A provider key alone does not provision these records; use the sequence in [Mistral harness readiness](../plans/mistral-harness-readiness.md#credential-and-configuration-handoff).

Disposable database races, reconstruction and the instrumented restart probe can run on an independent local stack without a live Mistral account. Their dispatch counters must observe the actual test execution. These checks do not establish real-provider connectivity or complete the normal gateway/browser acceptance gate.

The optional `phase4-acceptance` restart probe accepts the exact disposable C7 source and target module names on loopback. Supply a distinct, registered `AI_SPEND_READ_STDB_TOKEN` alongside the writer's `STDB_TOKEN`; the probe refuses to reuse the writer token for spend reads. The fresh target module must be built with `LUMIERE_RECONSTRUCTION_BOOTSTRAP_IDENTITY` set to the dedicated reconstructor identity before publishing it.

The live drill exposed a price-field codec mismatch: generated durable columns use `input_units_per_1_k` / `output_units_per_1_k`, while the module's canonical row JSON uses `input_units_per_1k` / `output_units_per_1k`. The shared projection/restore codec and target digest reader now translate both snapshot rates and the corresponding model-profile microunit cost fields. Regression coverage checks complete snapshot round trips, nullable profile prices and integers beyond JavaScript's exact-number range. This changes no schema or immutable contract pin.

Use the repository's optimized `ci-contracts` profile for the disposable module. A temporary unoptimized build allocated a 1,708,560-byte restore-function stack frame against a 1,048,576-byte WASM stack; the normal optimized artifact reduced the largest observed initial frame to 57,024 bytes and passed the committed-batch failure/resume step.

The trusted recreated-state set now matches all six entries in the pinned manifest. Requester-scoped `workflow_subject_snapshot` rows must be absent before completion; normal authorized requests recreate them after recovery. An unreadable or nonempty cache blocks completion. The evidence verifier also handles the numeric SATS Option variants returned by the live SQL endpoint, with malformed and nonempty pending-draft variants rejected by regression tests.
