# Alpha reusable work source foundation

Status: source implementation for review. Certification and live activation are deferred at the user's request.

Implementation base: main `0731e6864`, including the separately delivered owner/prepaid native foundation and immutable contracts `0.3.164`. Scope: the first source tranche of the [Alpha reusable-work plan](../plans/alpha-harness-reusable-work-railway-plan.md). This is not completion of that plan's ten-module acceptance or release gates.

## Implemented source

| Area | Delivery | Boundary |
| --- | --- | --- |
| AH-01/04 manifests and compiler | Strict versioned manifest with graph, schema, application and dependency pins; immutable identity and bounded validation; compiler resolves the existing report and five Finance graphs. | Uses the existing governed executor. Other module adapters, sandbox nodes and production dispatch are unavailable. A draft or hash is not a certificate. |
| AH-01/02 native persistence | Private personal company-scoped heads/immutable versions, CAS/idempotent save and exact server-hashed completed-run output nominations; full audit and organization-commit row images. | Nominations do not establish durable object storage, independent verification or publication. New native operations are denied through generic transport. |
| AH-06 publication | Canonical publication/placement validation and explicit CAS activate/revert/disable planning in presentation-core; actual API publication paths return unavailable. | Native activation persistence, trusted catalog admission and released generated API contracts remain required. No activation state is manufactured by the planner. |
| AH-02/03 sandbox outputs | Authenticated exact-run artifact reopen from the durable operational journal after guest destruction/restart; hash/length/MIME, descriptor membership, scope/current-policy and cleanup checks. | Journal retention/object-store promotion and deployed isolation remain separate. Existing production sandbox fence stays closed. |
| AH-10/11 observable comparison | Bounded provenance-aware trace metadata, attributed corrections and pure forensic comparison referencing existing intelligence/evidence records. | No duplicate provider audit, runtime emission wiring, admitted trace API or provider/effect replay. Trusted readers must authorize referenced records. |
| AH-12 procedural memory | Private immutable recipe bindings and append-only revocation, grounded in existing independently reviewed procedure knowledge and verified same-program successful cases from distinct completed runs. | No automatic review/promotion, semantic discovery, live memory-lift evaluation or new execution authority. |
| AH-07 web review | Internal reusable-program review component, closed scalar input validation and explicit existing scoped run-history reads; stale result protection and unavailable controls. | Component is unmounted from public discovery pending a released backend catalog and admission. No invented program API, simulated save success or implicit dispatch. |

## Native contract delta

Five new private tenant-owned tables: `ai_work_program`, `ai_work_program_version`, `ai_work_program_output_nomination`, `ai_work_program_recipe` and `ai_work_program_recipe_revocation`.

Four new denied operations: `save_ai_work_program_draft`, `nominate_ai_work_program_output`, `register_ai_work_program_recipe` and `revoke_ai_work_program_recipe`. Source operation IDs, exposure, company scope, storage classification and the tenant census are updated together. The new census is 533 tables.

The authored C1 policy manifest is source configuration. Fresh generation from an actual SpacetimeDB 2.8.2 module produced both SDKs, the HTTP schema, IR, reconstruction dispatch and canonical migration 35. The immutable ledger preserves every earlier SQL entry and advances its pending version to 36; application migration 34 remains the separately delivered chat-import migration. Operation history records four additions and no historical shape changes. No generated reconstruction file, released SQL, immutable tag or contract archive is edited by hand. The existing release workflow published and pinned contracts `0.3.165` at revision `d6050d9b9e2f83b517d07acd2b4319c29ad4452c`, binding clean source `86937375b` and schema `sha256:5aeb681961acf97742af8ed52ec9163c87cbac9b0d3fcd4c804d578b6e173460`. Release run [41356361357](https://github.com/KevTiv/lumiere-v-1/actions/runs/41356361357) passed both clean regeneration and final pin drift verification before committing the consumer archives, lockfiles and compatibility manifest.

The existing report/Finance proposed manifests and development seed are refreshed through `finance-skill-manifests.py` because sharing the canonical graph hash changes a source-bound file. No existing tenant certificate, promoted release or deployment is changed.

## Review and validation

Independent source review identified and corrected native/gateway manifest grammar disagreement. Cross-review also required preserving canonical report execution references separately from the WorkProgram content address, so the existing report-specific evidence/answer gates cannot be skipped. Optional malformed numeric inputs must remain invalid rather than silently becoming omitted inputs.

Exact final command results are recorded in the PR. The completed local checks include controller tests and real local synthetic QuickJS/SQLite acceptance, web helper and mounted component tests, presentation-core semantic tests, native type checking, source-bound manifest/catalog checks, tenant-source census checks and source lints. Initial source tests used prepared contracts `0.3.164`; after the immutable release, a frozen frontend refresh and full web TypeScript check pass against `0.3.165`. The final pinned checks use the checksum-verified `0.3.165` archive. Hosted PR CI and deployed acceptance remain separate.

The complete `make check-codegen-pinned` passes against `0.3.165`, including release compatibility, C0/C1 ownership and storage, C2 commit coverage, C8 guards, HTTP Option metadata and clean IR verification. The four new reducers use direct registered canonical commit calls; shared helpers still construct the same audited full-row changes. C2 verification and its nine regression tests pass without scanner changes or exceptions.

## Remaining implementation and deferred proof

This source tranche does not complete native publication/activation, released program API/catalog wiring, ten-module dataset adapters, sandbox compute nodes in the canonical executor, durable object-store artifact promotion, runtime trace emission/read adapters, effect-safe current-state replay, memory-lift evaluation, scheduled program dispatch or integrated module UI placement. Keep these packages partial in the execution plan.

Certification, paid model/compute execution, Railway provisioning/deployment, customer-data sandbox enablement and production user acceptance are deferred. Neither an environment flag nor passing CI may turn this source candidate into an admitted runtime.

## CI inventory correction and browser diagnostics

At source head `57d929328`, CI stopped on stale Finance inventory source hashes, so the downstream Rust/frontend/contracts jobs did not run. Regenerated the inventory with its canonical generator and verified it, its fifteen focused tests, skill manifests/catalog and source lints.

The P0 quarantine scenario timed out and its manual browser-context cleanup masked the original error. Its actor contexts now use a Playwright fixture with independent teardown; every original quantity, identity, replay and denied-actor assertion is retained. Named bounded test steps preserve the original 180-second scenario ceiling and expose the failing phase. The focused real-stack hosted run on `c2564bcb7` passed in 31.2 seconds. A complete P0 run is still required on the final contracts-pinned head to cover suite ordering and load. No timeout increase, test skip or product authorization change was introduced.

Merging main `308e9af79` resolved the package-script conflict that prevented new pull-request workflow runs. Subsequent CI identified module formatting, three opaque input-schema records and a stale 528-table contract pin. Formatting and the parser are corrected without changing the 2240-record ratchet baseline. The review component now uses the shared Select, with false, zero and empty text distinct from unset; 14 mounted tests and five input-helper tests pass. Actual generation validates 533 tenant-owned tables, and the generator Rust suite passes 143 tests with one existing ignored test. All 257 Python script tests pass. All 16 PostgreSQL 18 C4 tests pass with no skips, including the populated migration-35 proof preserving source rows, immutable versions, large unsigned IDs, separate tenant recipes and revocations across repeated startup and a fresh connection pool. The actual publication HTTP admission test also passes. The immutable release/pin is complete; final PR CI and full P0 remain required before merge.
