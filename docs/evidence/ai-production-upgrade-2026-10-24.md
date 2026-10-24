# AI production upgrade checks — 2026-10-24

The combined repair preserves live row layouts and the canonical passage owner.
PR #257 remains a release candidate. No production publish, migration, or AI
provisioning has run during these checks.

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
`major_version_upgrade=false`, for the lean source repair at `782f61bf8`.
WASM SHA-256: `3103db9676569949de05b3628a98441a758f08902a2f70ddcaebd9c7a9d79f72`.
This check did not publish and did not retain or display the migration token.
The later combined source also incorporates PR #258's defaults and upgrade guard.
Its final release image still requires its own exact-artifact check before deployment.

## Executed checks

- Production module build with developer reducers disabled passed.
- Populated local upgrade passed for all seven affected tables. Every existing
  field matched before and after publish with `--delete-data=never`. The embedding
  metadata defaults were empty fingerprint / `legacy-unverified`.
- PostgreSQL migration tests passed: exact archive, tenant/company scope,
  quarantine, forced mismatch rollback, canonical-row preservation, and partial
  legacy-shape rejection. Legacy columns and their values remain intact.
- 20 focused durable migration generator tests passed.
- Railway stack release shell tests and 13 workflow tests passed.
- Pilot provisioning script tests and the offline USD 1 plan passed without
  provider requests or spending.
- The previous PR head `d5e522d0d66cde4a516c97154f3d66611c61c27d`
  passed 25 hosted checks. The combined source requires fresh exact-head checks.

## Release and pilot gates

Contracts 0.3.141 remains immutable. Concurrent contracts 0.3.142 came from
PR #258's source and omitted the workflow additions carried by 0.3.141, including
migration 22. The combined successor must retain the union of both sources and
preserve the released migration bytes from 0.3.141. Do not repin directly to
0.3.142 or overwrite either tag.

The requested USD 1 proposal is
`infra/railway/pilots/alpha-org-usd1.proposed.json`, with its review record beside it.
It is not yet an approved or applied production configuration. Railway still
lacks MISTRAL_API_KEY and AI_HARNESS_MANIFEST_JSON at the last presence-only check.

Production has Alpha org/company 1, no AI agents/profiles/policies/budgets, and no
active report_analysis skill release. The production certification registry only
executes low_stock and report_composer candidates. A report_analysis candidate
adapter that executes the real governed runtime in an isolated immutable fixture
is still required, followed by real certification, independent promotion, and the
live spend-settled pilot. Do not seed or fabricate a passed certificate/release.

Embedding and vision provider variables are unset and currently default to Ollama.
No Ollama service was found. This pilot proposal does not select an embedding
space, migrate a vector collection, or claim document/RAG acceptance.
