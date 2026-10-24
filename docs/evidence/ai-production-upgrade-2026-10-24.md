# AI production upgrade checks — 2026-10-24

The combined repair preserves live row layouts and the canonical passage owner.
PR #257 remains a release candidate. No production publish, database migration, or tenant AI
provisioning has run during these checks. The approved Railway manifest is
staged without deployment.

## Schema

A read-only production inspection found seven incompatible table changes in the
prior candidate: reordered payment/provider/country-pack fields, removal of
`document.index_content`, and removal/replacement of embedding payload fields.
The repair retains every existing field and its order. The two new embedding
metadata fields are appended with explicit defaults. New document/embedding rows
leave legacy payload slots empty. Existing payloads remain available for audited
retirement and are never used as canonical AI evidence.

The live schema has 515 tables. The repaired candidate has 517 tables. All existing
column prefixes match; only `search_embedding.expected_fingerprint` and
`search_embedding.index_generation` are appended to existing tables.

The production server's read-only `pre_publish` check returned `AutoMigrate`, with
`major_version_upgrade=false`, for the final combined lean source at
`011eebf15012a1dc36519f9a70b3e27b3500afdb`.
WASM SHA-256: `d3b308223cc7644aaadf2cc782a2352967bb4a3454d6942c60e53b2dc1c8e72e`.
The same artifact passed the populated seven-table upgrade test. The checks did
not publish to production and did not retain or display the migration token.
The final release image still requires its own exact-image verification.

## Executed checks

- Production module build with developer reducers disabled passed.
- Populated local upgrade passed for all seven affected tables. Every existing
  field matched before and after publish with `--delete-data=never`. The embedding
  metadata defaults were empty fingerprint / `legacy-unverified`.
- PostgreSQL migration tests passed: exact archive, tenant/company scope,
  quarantine, forced mismatch rollback, canonical-row preservation, and partial
  legacy-shape rejection. Legacy columns and their values remain intact.
- Full codegen: 136 passed, one existing ignored.
- Consumer on contracts 0.3.143: 30 PostgreSQL migration tests passed against
  disposable databases; gateway 729 passed with eight existing ignored;
  525 web unit tests, TypeScript, and 12 release-manifest regressions passed.
- The corrected exact release-revision assertion passed its focused test.
- Fresh generation matches every pinned binding, manifest, TypeScript SDK and
  frozen SQL artifact. The canonical schema hash matches 0.3.143.
- Railway stack release shell tests and 13 workflow tests passed.
- Pilot provisioning script tests and the offline USD 1 plan passed without
  provider requests or spending.
- The previous PR head `d5e522d0d66cde4a516c97154f3d66611c61c27d`
  passed 25 hosted checks. The combined source requires fresh exact-head checks.

## Release and pilot gates

Contracts 0.3.141 remains immutable. Concurrent contracts 0.3.142 came from
PR #258's source and omitted the workflow additions carried by 0.3.141, including
migration 22. Contracts 0.3.143 retains the union of both sources and
preserves the released migration bytes from 0.3.141. It was published at
`a4f54b97c49fa78514233f19f4461323b9e5d0d4` after
[PR #23](https://github.com/KevTiv/lumiere-contracts/pull/23) and
[exact merged-commit CI](https://github.com/KevTiv/lumiere-contracts/actions/runs/40117966192) passed. Do not repin directly to
0.3.142 or overwrite either tag.

The requested USD 1 proposal is
`infra/railway/pilots/alpha-org-usd1.json`, with its review record beside it.
The user approved the exact JSON on 2026-10-24. AI_HARNESS_MANIFEST_JSON was
staged on the production ai-gateway service with `--skip-deploys` and read back
exactly. No tenant database configuration was applied. The user then added
MISTRAL_API_KEY directly to Railway. The read-only key/catalog check found both
approved models and returned `catalogVerified=true`, `billableCalls=0`.
Production preflight also passed with `RAILWAY_ENABLE_AI=true`.

Production has Alpha org/company 1, no AI agents/profiles/policies/budgets, and no
active report_analysis skill release. The new report_analysis certification adapter runs the same typed governed
program, policy, calibration, capability admission and answer gate as the live
runtime. Its brokers replay only pinned public synthetic analytics and provider
transcripts. They have no credentials, network, filesystem or live tenant state.
The expected output stays outside adapter input. Provider metadata explicitly
says `certification-fixture`; no model call or spending is implied.

The adapter and active release both require exact version 1.0.0 and the compiled
bundle hash. `gateway certification-bundles` returns these public hashes before
loading configuration or credentials. The reviewed-source proposal is
`infra/railway/pilots/report-analysis-certification-manifest.proposed.json`;
its public dataset and exact assertion are in
`infra/railway/pilots/report-analysis-certification-fixture.json`.
The source hash is `sha256:61a80f786acc7f08b12a750ccdb3a300c4d831d3b96a3cc35977f20277fdc696`.

All 736 gateway tests passed with eight existing ignored. Seven new tests cover
the real graph and exact fixture output, source mismatch, independence from
expected output, foreign tenant and company data, live-agent binding, policy
limit drift, transcript mismatch/leftovers, forged passage text hash, and a
claimless generated answer held for review. The normal readiness test now uses
the actual compiled source hash and rejects a stale hash. Development-only
seeded releases for the three source-bound adapters use the same compiled
hashes. The seed module's WASM-target check and focused seed formatting check
passed. A full module formatting check reports existing differences outside
this change; those files were not edited.

These are local code/fixture checks. The new commit still needs hosted checks,
the exact immutable runtime image and ordered deployment, a real worker
certification record, independent promotion, and the live spend-settled pilot.
Do not seed or fabricate a passed certificate/release.

Embedding and vision provider variables are unset and currently default to Ollama.
No Ollama service was found. This pilot proposal does not select an embedding
space, migrate a vector collection, or claim document/RAG acceptance.
