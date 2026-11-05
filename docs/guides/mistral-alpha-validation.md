# Mistral Alpha validation

Local validation on 4 November 2026 generated the native metering contract
candidate from an actual disposable SpacetimeDB instance. Contract publication,
pin alignment, migration activation and deployed paid-provider acceptance remain
release prerequisites. See [activation](mistral-alpha-activation.md) for those gates.

## Provenance

The isolated source worktree was `/tmp/mistral-contracts-src`. Its native schema
baseline was `abbb629e94a765b385cb6bbda2f195834f35f3e5`; the baseline WASM was
published only to `lumiere-mistral-contracts` at `http://127.0.0.1:3410`.
The clean generated candidate records source commit
`ad330934e3c8efd6df56e5cfeeb0d13a23001a8b`. Its generated changes and scalar-index
planning fix were subsequently cherry-picked as `a5ef979bf`.

| Artifact | SHA-256 |
| --- | --- |
| Baseline WASM | `5ed3241a5e65f9e518f40cb73f7ab2123fce4cb890849838a1be64b01e497ceb` |
| Actual HTTP schema, version 9 | `8822ba7bddef769779a6465963f9728306638ffd5da177babca9a79f71c326b5` |
| Same schema in the official `V9` envelope | `abe15f2c8a209149ab5ffab925c5a9e19ae2b623d3f466ab51813a59682a71d1` |
| Canonical IR artifact bytes | `4228eeda0a5dc53e8cb96d37a539b709eb85ab0eb96232c7a5ef00a96f7af9bc` |
| Canonical IR semantic schema | `de4944288266bb62e43523d7348bfa58fd9a07927fb0cdca75d4386fdd677cd5` |
| Agent capability artifact | `ad0f8b75797bfdcbfce198825a588a67c00a9ea052a2c18ac040b6ccc21c3330` |
| Pending migration 36, complete SQL file | `eef4538410f2054d9e2597c3013de912f7a97f3aa9d47c8a3b08969e869e406f` |

These hashes identify this recorded candidate. Regeneration from another clean
commit changes the provenance and artifact-byte hashes; review the semantic
schema hash and generated changes separately.

## Canonical generation

The installed CLI reports SpacetimeDB **2.8.2**, commit
`524b4487d949b61a07d4f39c862d1290259dfd20`. Its official hidden
[`generate --module-def` input](https://github.com/clockworklabs/SpacetimeDB/blob/524b4487d949b61a07d4f39c862d1290259dfd20/crates/cli/src/subcommands/generate.rs#L205)
parses `DeserializeWrapper<RawModuleDef>`, validates conversion to `ModuleDef`,
and calls the same language emitters used after WASM extraction. The exact
upstream source file was verified against the v2.8.2 tag; both have SHA-256
`ec73c4e8f8a9c72d0067466c4d2d08eee36d50683ad5fed2e585cc1899a02789`.

This route avoids recompiling the 74 MiB module merely to extract its schema.
No binding generator or schema definitions were rewritten. The only input
conversion wrapped the captured JSON in `{"V9": ...}` and asserted equality of
the inner definitions.

Recorded commands ran from the isolated worktree:

```sh
SCHEMA_SNAPSHOT_HTTP_ONLY=1 \
STDB_MODULE=lumiere-mistral-contracts \
STDB_SCHEMA_HOST=http://127.0.0.1:3410 \
bash scripts/schema-snapshot.sh

python3 - <<'PY'
import json
from pathlib import Path
schema = Path('.contracts-staging/module-schema.json')
wrapped = Path('.contracts-staging/module-schema-v9-enveloped.json')
original = json.loads(schema.read_bytes())
wrapped.write_text(json.dumps({'V9': original}, separators=(',', ':')) + '\n')
assert json.loads(wrapped.read_bytes())['V9'] == original
PY
```

A temporary `SPACETIME_BIN` adapter supplied the isolated CLI config, replaced
`--bin-path /tmp/mistral-schema-baseline.wasm` with
`--module-def /tmp/mistral-contracts-src/.contracts-staging/module-schema-v9-enveloped.json`,
and appended `--no-config`. It verified the baseline WASM hash above before
executing the unchanged installed CLI. This let the repository's existing SDK
wrappers retain keyword repairs, bounded Rust formatting, TypeScript annotations
and HTTP Option metadata generation:

```sh
export PATH=/workspace/.cargo/bin:$PATH
export CARGO_HOME=/workspace/.cargo
export RUSTUP_HOME=/workspace/.rustup
export CARGO_TARGET_DIR=/tmp/mistral-codegen-target
export CARGO_BUILD_JOBS=1
export STDB_GENERATE_WASM=/tmp/mistral-schema-baseline.wasm
export SPACETIME_BIN=/tmp/mistral-spacetime-canonical-schema-cli

bash scripts/generate-spacetimedb-rust-sdk.sh .contracts-staging/bindings spacetimedb
bash scripts/generate-spacetimedb-ts-sdk.sh .contracts-staging/ts/generated spacetimedb
cargo build --locked -p lumiere-codegen
C0_ENFORCE_TENANT_OWNERSHIP=1 /tmp/mistral-codegen-target/debug/lumiere-codegen
```

The companion emitter from the pinned contracts package was copied into
`/tmp/mistral-contracts-candidate`, together with the actual clean IR, capability
artifact and checksum sidecars. Its temporary local `ir/PIN.json` identified
those exact bytes and source commit; no shared or published pin changed.

```sh
python3 /tmp/mistral-contracts-candidate/scripts/generate-from-ir.py
python3 /tmp/mistral-contracts-candidate/scripts/generate-from-ir.py --check
```

## Results

- Canonical IR: **1,516 operations, 373 resources, 535 tables and 1,449 types**.
  Strict clean-provenance, checksum and semantic-hash verification passed.
- All 535 tables passed organization ownership and storage-policy checks.
  Both metering base tables are private. The five metering reducers are denied
  to generic session dispatch; their two views require authenticated identities.
  All seven operation IDs are locked and non-client-facing. Reservation metadata
  validates the exact nested company ID.
- The capability artifact retains three reviewed entries and admits none of the
  new metering operations as generic agent tools. Companion descriptor generation
  and byte-for-byte `--check` passed.
- All **144 ordinary codegen tests** passed. The normally ignored
  `durable_postgresql_ir::tests::current_canonical_handoff_matches_all_released_migrations_and_manifest`
  was then run explicitly against the actual staging tree and passed: **145 tests
  validated in total**. Five company-scope tests, six HTTP Option metadata tests
  and the Option metadata drift check passed.
- Generation exposed differing scalar-index declaration order in eight existing
  SDK tables. The parser now sorts scalar indexes to match the existing canonical
  IR renderer. A shuffled-order regression passes; the planning mismatch guard
  remains enforced.
- Every one of the 17 released migration files remains byte-identical. Pending
  `0036_durable_projection_delta.sql` adds only `ai_metered_price` and
  `ai_metered_usage`, with their organization indexes. It alters no existing
  table and is generated under `.contracts-staging/manifests/pg_ddl/migrations/`.

## Isolated native fixture

Native source `58211ddcf` compiled with the `ci-contracts` profile,
`LUMIERE_ENABLE_DEV_REDUCERS=1`, optimization level 0 and 256 codegen units.
The original WASM SHA-256 was
`028c8e3e2ae95d7237c7daba1fec428c6d7ff2f34204dbf9745b1d2cc215edd5`.
Binaryen 123 with `-O1` produced the fixture WASM SHA-256
`b2a90bc821914e1e0f83d843713e92c3dbb32d5cb3d7b2bee247df27a9d7eec9`.

That artifact successfully upgraded the disposable local module at
`127.0.0.1:3410`. `run_ai_spend_recovery_tests` passed, and SQL readback confirmed
metered `unit = pages` with `actual_units = 2`.

This runtime artifact predates the generated reconstruction changes in
`a5ef979bf`. A subsequent native check at source `2c9197f35` passed, including
that generated reconstruction code and all native test compilation:

```sh
CARGO_BUILD_JOBS=1 \
cargo check --manifest-path spacetimedb/Cargo.toml --locked --tests
```

## Application checks

| Check | Result |
| --- | --- |
| Gateway unit and integration suites | 972 passed; nine existing ignored |
| Full web unit suite | 986 passed |
| Full web TypeScript check | Passed with an 8 GiB Node heap |
| Python script tests | 272 passed |
| Agent/capability/preflight provisioning tests | 35 passed |
| Alpha edge route tests and Kong rendering | Five tests and rendering passed |
| Translation keys, locales and loanword checks | Passed |
| Browser operation transport, opaque-record and trusted-route checks | Passed |
| Gateway and API Rust compilation | Passed |
| Final native module and test compilation, including generated reconstruction | Passed |
| Focused API ingestion unit tests | All 11 passed |

The earlier concurrent API test compilation and native build exhausted the
workspace memory limit. The final authority WASM build, local runtime checks and
API retry succeeded after serializing heavy work. The API retry used one Cargo
job, no test debug symbols and 256 codegen units:

```sh
CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 \
CARGO_PROFILE_TEST_CODEGEN_UNITS=256 \
cargo test --locked -p api-server --lib evidence_ingestion::tests -- --nocapture
```

No paid Mistral calls were made.

## Release handoff

Operation-history verification intentionally reports exactly these unrecorded IDs:

```text
erp.ai_metered_price_read
erp.ai_metered_usage_read
erp.claim_ai_metered_dispatch
erp.configure_ai_metered_price
erp.reconcile_ai_metered_spend
erp.reserve_ai_metered_spend
erp.settle_ai_metered_spend
```

The release lane binds these to the actual immutable release and aligns its
consumer pins. No future tag, operation-history revision or release checksum is
inferred from this candidate.

The [migration ledger workflow](../../lumiere-codegen/pg-migration-ledger/README.md)
owns promotion of pending SQL. Its tracked destination is
`lumiere-codegen/pg-migration-ledger/0036_durable_projection_delta.sql`, promoted
with the consumer, ledger advancement, an API migration catalog entry and the
application catalog compatibility update.

## CI follow-up on 5 November 2026

The first CI failure was the generated finance change-review inventory: its
input checksums had not been refreshed for the new native operation metadata.
Regeneration fixed that failure. Native module declarations were also sorted
with the repository's changed-file formatter, and current main's browser-test
stabilization was merged. The next CI run passed its scope, native compilation,
frontend typecheck and PDF structural checks.

The schema change also requires matching published contracts for the pinned
generation and live-schema drift checks. Migration 36 has now been promoted
verbatim into the tracked ledger with its API consumer. The ledger records 36 as
released and advances the next pending version to 37. API migration 36 is the
`alpha_mistral_metered_spend` change set 25 in the Expand phase. All previous SQL
files retain their original bytes; no database migration was executed here.

The runtime's migration catalog checksum example produced
`sha256:b6cbf01ce1c022cf428f646e9b472258e9bedc8e291dd5391fa856d1a7406427`,
now recorded alongside application catalog version 36 in the compatibility
manifest. All 43 targeted API migration and audit unit tests passed, including
preservation of the deployed 35-migration prefix and the exact two-table SQL.
Independent review and the release-manifest verifier passed.

The contract publisher now regenerates the finance inventory before committing
generated sources and checks it after clean regeneration. This preserves the
CI inventory gate throughout the normal publication and pin-alignment process.
