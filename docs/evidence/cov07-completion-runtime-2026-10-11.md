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

## Remaining acceptance gates

The new generated contract release and consistent application pin, complete
authenticated operator BOM/MO-to-close browser path, exact scrap/byproduct and
cost-result navigation with reload/recovery, and same-head PostgreSQL projection
and migration gates remain open. No new browser, PostgreSQL projection, CI or
public hosted-application pass is claimed here. Historical Docker browser and
migration results retain their own earlier immutable identities.

The [completion-stack plan](../plan/erp-cov07-completion-stack-plan.md) records
the intended changes and full D/A/O/E definition of done. The coordinator will
append final contract-generation/release, CI and other acceptance results when
those checks actually complete.
