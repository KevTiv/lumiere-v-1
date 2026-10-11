# COV-07 completion stack — bounded domain runtime evidence

Domain lifecycle: PASS. Full Manufacturing reducer suite: PASS.
Manufacturing module disposition remains U2/review; A/O/E remain partial.

## Immutable implementation and artifact

- Upstream integration base: [PR #175](https://github.com/KevTiv/lumiere-v-1/pull/175),
  `9eb67a11744c159cac5f7cd2b4d363e0d452019a`, aggregate contracts v0.3.99.
- Executed integrated source: `b2b6b2b9c66c71b9bb1f4c0a7849eb615652f905`.
- Artifact: `spacetimedb/target/wasm32-unknown-unknown/ci-contracts/lumiere_v1.wasm`.
- SHA-256: `0daa975df48bd5bbfa0cc3ef2e3fd91116b4010c72e937ac589b5d82f3224a1b`.
- Isolated SpacetimeDB database: `lumiere-cov07-20261011`;
  server `http://127.0.0.1:3917`.
- Executor: coordinator; no database reset was performed for this publish.
  The CLI wrapper uses root directory `/workspace/.spacetime/cli`.

## Commands and results

From `/workspace/lumiere-v-1`, the coordinator built the producer:

```sh
CARGO_HOME=/workspace/.cargo RUSTUP_HOME=/workspace/.rustup \
PATH=/workspace/.cargo/bin:$PATH \
CARGO_PROFILE_CI_CONTRACTS_OPT_LEVEL=0 \
CARGO_PROFILE_CI_CONTRACTS_CODEGEN_UNITS=256 \
cargo build --manifest-path spacetimedb/Cargo.toml --locked \
  --target wasm32-unknown-unknown --profile ci-contracts -j1

/workspace/.spacetime/bin/cov07-spacetime publish --no-config \
  --server http://127.0.0.1:3917 \
  --bin-path /workspace/lumiere-v-1/spacetimedb/target/wasm32-unknown-unknown/ci-contracts/lumiere_v1.wasm \
  lumiere-cov07-20261011 --yes

/workspace/.spacetime/bin/cov07-spacetime call --no-config \
  --server http://127.0.0.1:3917 lumiere-cov07-20261011 \
  run_manufacturing_bom_to_close_domain_lifecycle_test

/workspace/.spacetime/bin/cov07-spacetime call --no-config \
  --server http://127.0.0.1:3917 lumiere-cov07-20261011 \
  run_all_manufacturing_tests
```

Build and publish succeeded. Both calls exited 0. The server logged
`COV-07h complete persisted BOM-to-close domain proof passed: MO 26` at
`2026-10-11T20:25:40.112835Z`, followed by
`run_all_manufacturing_tests complete` at `2026-10-11T20:25:40.892183Z`.
The full suite was rerun successfully on the same artifact, and the following
focused reducer calls also exited 0 on repeat, using the same call prefix:

- `run_manufacturing_bom_routing_lifecycle_test`
- `run_manufacturing_cost_configuration_scope_test`
- `run_manufacturing_actual_cost_valuation_test`
- `run_manufacturing_tracked_output_test`

## What the executed proof establishes

The [single lifecycle invariant](../../spacetimedb/tests/manufacturing/domain_lifecycle_test.rs)
creates one base-two BOM and a fractional 0.5-unit MO, consumes exact raw moves,
executes two operation-linked/blocking workorders with productivity and required
QC, records partial output and closes primary/byproduct output. It asserts
exact organization/company/product/location ownership, ID sets, stock
quantities, material/labor cost snapshots, allocation, inventory variance and
durable full-row commit envelopes. Rejected commands and replay preserve both
business effects and commit cursor/row-change effects.

The full suite also exercises existing relational, material, output, quality,
scrap/byproduct and workcenter paths, plus the new routed materialization,
configured accounting valuation and lot/serial output tests. Passing in-database
assertions constitute persisted domain evidence, not browser operator proof.

## Canonical IR and PostgreSQL DDL checks

At generator source `52a95452eb032543d1606f87aaa0adb3c2f94073`, normal full
generation and `cargo run -p lumiere-codegen --offline -- --postgresql-ir-only`
passed. All generated PostgreSQL DDL writes occur after the canonical handoff.
The clean IR validator passed with 1,444 operations, 369 resources, 510 tables
and 1,378 types. The IR artifact SHA-256 is
`6a53dd1921ac9619726fd0c4b342c1d3f2d668a2336cd84a169196c13a8d22e0`;
its semantic schema hash is
`sha256:1e97b9448f49e120640632ea468c7acd0917ab8cea09ba0acc4747b037e51c56`.
Frozen migration 14 remained byte-identical, SHA-256
`cf436ddd59cf2e2105bc7639ce4d8b1a3a3cd7906383a4e01fba60a2d595b84c`.

The agent executed all 126 codegen tests, including current-staging parity and
malformed-contract rejection. The coordinator independently executed the
post-handoff CLI and full generator. Existing projection-only bootstrap
compatibility templates remain gated by canonical commit-stream metadata;
complete template-body representation in IR is not claimed.

The coordinator started an isolated, unexposed PostgreSQL 16.15 container
`cov07-ir-pg-20261011` using image digest
`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
Each generated SQL artifact was applied with:

```sh
docker exec cov07-ir-pg-20261011 psql -U postgres -d cov07_ir \
  --set ON_ERROR_STOP=on --single-transaction --file=/ir-sql/migrations/FILE.sql
```

The explicit migration sequence was `0001_durable_projection`,
`0011_durable_projection_delta`, `0012_durable_projection_delta`,
`0013_durable_projection_delta`, then `0014_durable_projection_delta`.
Public table count increased from 794 to 798, adding exactly
`mrp_production_cost`, `mrp_productivity_cost`, `mrp_valuation_config` and
`mrp_workcenter_cost_rate`; the four tables have nine indexes including primary
keys. Reapplying 14 passed and retained 798 tables. Catalog inspection confirmed
numeric owner/primary-key columns, nullable numeric `account_move_id` and
non-null JSONB `raw_move_ids`. All six generated archive/protocol SQL files also
executed successfully. This check did not execute authored infrastructure
migrations 6–10, API migration-history tests, projection workers or convergence.
The new 13-to-14 API compatibility test is authored but not executed here.

An additional opt-in `C0_ENFORCE_TENANT_OWNERSHIP=1` generation attempt failed
the inherited hardcoded 471-relation count, which predates the upstream 506 and
current 510 relations. The ordinary generator separately classified all 510
relations as organization-owned and all 510 storage policies. The legacy
strict-count gate is not reported as passed or silently weakened.

## Contract candidate and frontend checks

Prepare-only contracts candidate `58cfe5e8f906a7fd86814c1d6ecf518baccc7f78`
at `/workspace/cov07-contracts-candidate-001/repo` passed Rust all-feature checking,
TypeScript package checking and package build. No remote commit/tag was
published by that local command. The label v0.3.100 is a local candidate label,
not evidence of a released/pinned dependency.

Twenty-one shared Manufacturing creation/confirmation/consumption/close/
workorder tests passed. A full web typecheck with a temporary path mapping to
the prepared candidate failed: the contracts generator's `TYPED_RESOURCE_READS`
allowlist omits all four Manufacturing cost resources. The generated operation
inputs and general query registry do include the additions. A companion
contracts emitter change is required; no handwritten decoder/cast workaround
or full frontend pass is claimed.

## Remaining acceptance gates

The new generated contract release and consistent application pin, complete
authenticated operator BOM/MO-to-close browser path, exact scrap/byproduct and
cost-result navigation with reload/recovery, and same-head PostgreSQL projection
and full API migration gates remain open. No new browser, PostgreSQL projection, CI or
public hosted-application pass is claimed here. Historical Docker browser and
migration results retain their own earlier immutable identities.

The [completion-stack plan](../plan/erp-cov07-completion-stack-plan.md) records
the intended changes and full D/A/O/E definition of done. The coordinator will
append final contract-generation/release, CI and other acceptance results when
those checks actually complete.
