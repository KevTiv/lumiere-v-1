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

The authored C1 policy manifest is source configuration. No generated reconstruction file, released SQL, immutable tag or contract archive is edited by hand. Fresh native SDK/IR generation, canonical reconstruction/migration generation, populated upgrade evidence and immutable publication/pinning remain prerequisites for merging an application-contract-changing candidate. Contracts `0.3.164` are the build base, not a release of the five new tables. The `codex/draft-backend-*` branch keeps this prerequisite review separate from automatic contract publication.

The existing report/Finance proposed manifests and development seed are refreshed through `finance-skill-manifests.py` because sharing the canonical graph hash changes a source-bound file. No existing tenant certificate, promoted release or deployment is changed.

## Review and validation

Independent source review identified and corrected native/gateway manifest grammar disagreement. Cross-review also required preserving canonical report execution references separately from the WorkProgram content address, so the existing report-specific evidence/answer gates cannot be skipped. Optional malformed numeric inputs must remain invalid rather than silently becoming omitted inputs.

Exact final command results are recorded in the PR. The completed local checks include controller tests and real local synthetic QuickJS/SQLite acceptance, web helper and mounted component tests, presentation-core semantic tests, native type checking, source-bound manifest/catalog checks, tenant-source census checks and source lints. A test against an older cached contract package is not final-pin evidence; final commands use the prepared `0.3.164` package. Hosted CI, generated-contract drift/upgrade lanes and deployed acceptance remain separate.

## Remaining implementation and deferred proof

This source tranche does not complete native publication/activation, released program API/catalog wiring, ten-module dataset adapters, sandbox compute nodes in the canonical executor, durable object-store artifact promotion, runtime trace emission/read adapters, effect-safe current-state replay, memory-lift evaluation, scheduled program dispatch or integrated module UI placement. Keep these packages partial in the execution plan.

Certification, paid model/compute execution, Railway provisioning/deployment, customer-data sandbox enablement and production user acceptance are deferred. Neither an environment flag nor passing CI may turn this source candidate into an admitted runtime.

## CI inventory correction and browser diagnostics

At source head `57d929328`, CI stopped on stale Finance inventory source hashes, so the downstream Rust/frontend/contracts jobs did not run. Regenerated the inventory with its canonical generator and verified it, its fifteen focused tests, skill manifests/catalog and source lints.

The P0 quarantine scenario timed out and its manual browser-context cleanup masked the original error. Its actor contexts now use a Playwright fixture with independent teardown; every original quantity, identity, replay and denied-actor assertion is retained. Named bounded test steps preserve the original 180-second scenario ceiling and expose the failing phase. Playwright test discovery passes. The underlying browser timeout is not claimed resolved until a new real-stack run passes; no timeout increase, test skip or product authorization change was introduced.
