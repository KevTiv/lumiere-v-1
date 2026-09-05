# Code ownership, deduplication, and modularization: implementation handoff

Status: **PLANNED — implementation has not started under this document.**
Created: 2026-09-05.
Authoring checkout: `e17680f04`; substantial unrelated working-tree changes were present.
Audience: a Sonnet/GLM implementation session, with or without subagent support.
Execution owner: the primary implementation session, responsible for reviewing and integrating every contribution.

## 1. Start here

This is a repo-grounded execution plan, not permission to launch all work at once. Read it completely, refresh the evidence, then work through accepted dependencies. A historical count, file path, line number, warning, or passing test is not a current baseline.

The desired result is a codebase where a business rule or wire-format behavior has an identifiable owner, callers use that owner, and large modules are divided by coherent responsibilities. Adding a utility while leaving its copies in production is not completion. Moving duplicated logic into several smaller files is not completion either.

Related documents:

- [API-server modularization plan](api-server-modularization-coordination-plan.md): authoritative detailed destination map and M00–M90 extraction tasks for the API-server. Execute those tasks once, through D40 below; do not create a competing module layout.
- [Build DX / CI execution ledger](build-dx-ci-execution-plan.md): records the already implemented batch and separate outstanding DX2–DX7 work. Do not reimplement completed changes or claim the remaining work is done.
- [Build and CI operating guide](../guides/build-and-ci-dx.md): fast-path commands, cache rules, and operational caveats.

### Copy-paste coordinator prompt

```text
Implement docs/plan/code-ownership-deduplication-refactor-plan.md in this repo.
Read AGENTS.md and the complete plan, including its companion modularization
plan, before editing. Start at D00; do not accept historical findings blindly.

Act as the integration owner. If subagents are available and authorized in
this execution session, give them bounded, disjoint tasks from the plan.
Otherwise perform the same tasks sequentially. Do not create user-owned
background tasks as a substitute for subagents.

For each batch, freeze interfaces, add/retain behavior tests, implement the
smallest coherent change, review the actual diff and callers, integrate all
wiring, and run the required checks on the combined tree. Track task state,
file ownership, decisions, evidence, and blockers in the plan's execution log.

Separate behavior corrections from deduplication and mechanical moves.
Preserve tenant authorization, canonical generated types, transaction/fence
ownership, wire formats, and test discovery. Do not suppress tests, overwrite
unrelated work, delete test support, or introduce a universal utility framework.

Use the fast relevant checks during work; reserve one Cargo/codegen slot.
Never use make test, publish-clear, or a database wipe on an unapproved target.
Do not publish contracts, change schemas, push, merge, or change CI protection
unless the user separately authorizes those actions in this execution session.

Continue through review and integration, not merely agent handoffs. If a
required decision or environment is missing, finish independent safe work,
record the exact blocker, and ask for the necessary direction. Never mark
unverified work complete. At handoff, name the next executable task.
```

## 2. Scope, authority, and non-goals

Creating this plan changes documentation only. A later request to execute it authorizes scoped implementation and the explicit correctness fixes described here, not external publication or production operations. Ambiguous product semantics still require the decision gates below.

In scope:

- Duplicated relation checks, accounting parameter construction, metadata manipulation, receipt replay, and integration-worker scaffolding.
- Inconsistent IDs, timestamps, field aliases, CSV parsing, contact normalization, and Rust row decoding.
- Incomplete adoption of existing AI-route, audit-formatting, and other shared helpers.
- Shadow policy/registry definitions, canonical JSON primitives, identifier handling, navigation data, and repeated build/CI setup.
- The previously audited HTTP error/auth boundary, warning hygiene, and API-server god-file extraction.
- Bounded frontend/domain file segmentation where the identified families currently live.

Not authorized by this plan:

- Schema/table/reducer/wire-contract changes, a contracts release, dependency-pin changes, migrations, production data repair, or tenant-policy redesign.
- Replacing the database stack, introducing one crate per domain, rewriting all CRUD hooks into a generic framework, or unifying all renderer backends.
- Removing required CI coverage, changing branch protection, broad workflow sharding, or claiming measured speedups without measurements.
- Repository-wide formatting, unrelated dead-code sweeps, or deleting code solely because it emitted a warning.

## 3. Evidence and risk model

Classify each finding during D00/D01:

| Class | Meaning | Required treatment |
| --- | --- | --- |
| E — equivalent | Bodies and accepted input/output behavior agree | Characterize, extract/reuse, migrate all intended callers, remove copies |
| V — variant | Similar purpose, but inputs, failure behavior, defaults, or scope differ | Write a behavior matrix; preserve named adapters or approve a focused correction |
| S — shadow | Competing definitions, potentially without live consumers | Trace consumers/exports/tests; retire only proven obsolete surfaces or establish one source |
| I — intentional | Separate enforcement boundary, generated output, forwarding wrapper, or distinct protocol | Retain; document the reason and any parity requirement |
| C — candidate | Similar-looking code without sufficient body/caller evidence | Investigate before assigning edits; do not count it as confirmed debt |

### Verified starting evidence, to refresh before implementation

Paths in this document are repository-relative for portable handoff. Use function names as locators; lines will move.

| ID | Finding and current evidence | Class | Work |
| --- | --- | --- | --- |
| F01 | `erp-shared/src/form-coercion.ts::optionalBigIntU64` rounds string `9007199254740993` through `Number`; `query-hooks/src/hooks/{hr,pos,auth}.ts::toScalarU64` preserves that string but accepts negatives | V | D10 |
| F02 | `ui/src/lib/entity-row-utils.tsx`, `stored-dashboard-resolver.ts`, proposal row helpers, and audit formatting accept different aliases/nulls/timestamp representations | V/E | D11 |
| F03 | `web/lib/contact-duplicate-detection.ts` falls back from blank phone to mobile; `import-duplicate-detection.ts` does not; the same fixture produces one CRM pair and zero import matches | V | D12 |
| F04 | `spacetimedb/src/data_ops/helpers.rs::split_csv_row` and `ai-gateway/src/skills/import.rs::split_csv_row` match; their outer parsers differ on headers; frontend CSV parsing also differs on blank lines | E/V | D13 |
| F05 | `accounting/fx_revaluation.rs::load_fx_account` matches `accounting/relations.rs::require_active_account`; tax-list validation is copied across `chart_of_accounts.rs` and `tax_management.rs` | E | D20 |
| F06 | Analytic-account validation matches across `projects/projects.rs`, `expenses/expenses.rs`, and `purchasing/purchase_orders.rs` | E | D20 |
| F07 | Four employee-scope helpers match in `hr/{benefits,performance,documents,onboarding}.rs`; `global_assignment.rs` intentionally checks organization and returns company information | E/I | D21 |
| F08 | `subscriptions/subscription_wave_d.rs::load_subscription` matches `subscription_wave_e.rs::load_sub`; both have production callers | E | D21 |
| F09 | Four line constructors match in payroll/expense files; a second pair matches in purchasing returns/subscription billing. Company-only account validators are not equivalent to active org/company validation | E/V | D22 |
| F10 | `sales/sales_core.rs::merge_exchange_rate_metadata` matches `purchasing/purchase_orders.rs::merge_po_exchange_rate_metadata` | E | D23 |
| F11 | `workflow/{runtime,migration}.rs::replay_receipt` have matching lookup/conflicting-input behavior and active callers | E | D24 |
| F12 | API expense/HR/project integration workers repeat polling/readiness/configuration/batch orchestration | E/V | D25 |
| F13 | Next AI forms suggest/validate duplicate sanitization; RAG stream/non-stream duplicate preparation; existing `_lib/route-helpers.ts` is only partially adopted | E/V | D30 |
| F14 | AI has matching `row_u64` copies; API query/workflow/auth decoders differ on strings, signed values, identities, and Option envelopes | E/V | D31 |
| F15 | Canonical JSON recurs across cold-tier/persistence and AI audit/certification. Audit uses UUID-v5 while certification uses SHA-256 | E/I | D32 |
| F16 | PG identifier validators/quoters disagree on allowed names; codegen/runtime case conversion differs, including relation suffix handling | V/I | D33 |
| F17 | UI sidebar and command palette duplicate navigation catalog data and resource-permission mappings | E | D34 |
| F18 | HR PII constants/predicates are represented in `crates/stdb-auth/src/field_policy.rs` and `spacetimedb/src/hr/pii.rs`; some module-side predicates have no callers found, but compensation constants are used | S | D35 |
| F19 | AI snapshot specifications are handwritten in Rust and `erp-shared/src/ai-entity-snapshot-registry.ts`; Rust has a consumer, TS lookups had no direct consumers found beyond definitions/export | S | D35 |
| F20 | API error stringification/session preambles and warning/stub/PDF findings from the earlier audit need scoped handling, with its corrections preserved | V/C | D36/D37 |
| F21 | Repeated SSH/frontend workflow setup and E2E lifecycle orchestration remain around the already extracted DX helpers | E/V | D50 |
| F22 | Previously audited mixed-responsibility API files; large frontend hooks and historical domain wave files make the above owners harder to locate | Structural | D40/D41/D42 |

Frontend paths abbreviated in this table start under `frontend/packages/` or `frontend/web/` as indicated. The task descriptions below identify full source roots.

### Evidence that must not be overclaimed

- Reproductions were isolated execution of existing TypeScript functions, not an end-to-end production incident proof.
- For numeric input `1725494400000`, the audit timestamp helper returned a 1970 date while the millisecond date interpretation is 2024-09-05. This proves incompatible assumptions; it does not prove actual audit rows use milliseconds.
- AI `positiveInteger` accepts `12suffix` as 12 and truncates fractions; callers separately check positivity. Do not describe its negative return alone as an authorization bypass.
- Earlier counts such as 219 error conversions, 83 session preambles, and 19 warnings are historical, not acceptance metrics.
- Workflow crash/replay support and `merge_hot_cold_rows` are used in tests. They are not an abandoned production subsystem merely because normal-build warnings mention them.
- Worker DTO organization fields being unused does not establish absent organization scoping; the outer loop already scopes requests.
- A `From<anyhow::Error>` implementation does not automatically convert every other error type transitively. Deriving `thiserror` alone does not preserve sources stored as strings.
- Generated reducer lists, generator templates, API-client forwarding wrappers, and independent HTTP/reducer enforcement are not automatically removable duplication.

## 4. Architecture rules and final ownership

### Non-negotiable invariants

1. Organization comes from validated server/session/parent context; company selection is validated. Helpers never obtain a privileged client or infer a fallback organization.
2. Generated params, operations, resources, and row contracts remain canonical. Do not introduce handwritten shadow DTOs/enums to simplify extraction.
3. Preserve missing vs null vs empty vs false vs zero. An update patch's clear/preserve behavior is not interchangeable with form fallback behavior.
4. Preserve accounting signs, defaults, currency precision, company policy, ordering, soft deletion, and transaction ownership. Do not “improve” these incidentally.
5. Keep a single projection transaction owner and reconstruction fence-lifecycle owner. Helpers cannot independently commit, acquire another transaction, or release the fence.
6. Preserve checksum bytes, domain framing, hash algorithm/prefix, receipt keys, replay behavior, and order-sensitive arrays.
7. Preserve URLs, operation names, argument order, auth/cookie precedence, permissions, field redaction/audit, and handled-empty vs unrecognized dispatch.
8. No catch-all `utils.rs`, `helpers.ts`, generic repository framework, broad trait hierarchy, or registry plugin system. Reuse existing feature owners first.
9. No dependency cycle. `erp-shared` already depends on `stdb`/`api-client`; do not make those lower packages import `erp-shared` to share a helper. Prefer an existing lower owner, or explicitly document a narrow adapter/parity boundary.
10. Root service Rust and standalone `spacetimedb/` are separate build universes. Do not make the reducer module depend on service crates just to eliminate a small copy.

### Destination map

These are responsibility targets, not instructions to create empty files. During D01, select an existing owner when one already fits and record any naming substitution once.

| Responsibility | Preferred final home | Must not absorb |
| --- | --- | --- |
| Strict browser/form ID scalars | `frontend/packages/erp-shared/src/u64.ts`, with compatibility entry points in `form-coercion.ts` | Generated reducer params, unrelated number/price parsing |
| Pure frontend row access | `frontend/packages/erp-shared/src/row-values.ts` for upper-layer consumers | React rendering, patch semantics hidden behind universal fallback |
| Timestamp input adapters | `frontend/packages/erp-shared/src/timestamp-values.ts`; reuse `stb-timestamp.ts` for its existing outbound purpose | Guessing one universal numeric timestamp unit |
| Contact normalization/matching primitives | `frontend/packages/erp-shared/src/contact-matching.ts` | Permission checks, merge mutations, import product matching |
| CSV parsing behavior | Existing frontend CSV family and `spacetimedb/src/data_ops/helpers.rs`; AI parsing remains behind an explicit adapter/parity seam if direct sharing is unsuitable | AI mapping policy, formula safety, all import orchestration |
| Account/tax/analytic relations | Existing `spacetimedb/src/accounting/relations.rs`, or one analytic-owned child if needed | Every domain's FK checks |
| HR/subscription relation checks | `spacetimedb/src/hr/relations.rs`, `spacetimedb/src/subscriptions/relations.rs` | Cross-company assignment policy, subscription lifecycle commands |
| Journal-line defaults | `spacetimedb/src/accounting/line_params.rs` | Posting transactions, permission lookup, a universal builder with many optional switches |
| FX metadata | `spacetimedb/src/accounting/fx_metadata.rs` or an existing currency-owned pure module | Rate selection, currency conversion policy |
| Workflow receipt lookup | `spacetimedb/src/workflow/receipts.rs` | Entire runtime/migration state machines |
| Integration polling lifecycle | `api-server/src/integration_worker.rs` or a small directory only if cohesive children exist | Workflow outbox, projection/reconstruction state machines |
| AI HTTP request preparation | `frontend/web/app/api/ai/_lib/{form-request,rag-request}.ts` plus existing `route-helpers.ts` | Transport-specific SSE handling, a generic endpoint framework |
| Service wire row primitives | Existing `crates/stdb-client` codec seam for proven common transport behavior; initially keep query-specific adapters under `query_exec/row_values.rs` | Domain defaults, SQL authorization, reducer-side crate dependencies |
| Canonical JSON primitive | Existing cold-tier conventions and a small AI-local canonicalization owner | Different checksum protocols or UUID/SHA algorithms |
| SQL identifiers | One PG-specific cold-tier helper; generator-local equivalents tested against the same agreed names when needed | STDB-specific quoting, arbitrary user SQL |
| Navigation | `frontend/packages/ui/src/lib/navigation-catalog.ts` | Sidebar state, command dialogs, server authorization |
| Audit presentation | Existing `frontend/packages/ui/src/lib/audit-log-utils.ts` | General entity rendering |
| HTTP auth/error boundary | Existing `api-server/src/error.rs`, `web_session.rs`, existing session resolution | Business retry policy or privileged-client selection |
| CI/E2E setup | Existing `scripts/e2e-dx.sh` plus focused reusable CI setup under `.github/actions/` if justified | Permissions, event selection, required-gate decisions hidden from workflows |

Policy/registry shadow definitions have no automatic new destination: D35 must first determine whether both consumers exist. Do not generate and maintain a second output for an unused surface.

## 5. Coordinator and agent operating contract

### Before dispatch

- Inspect `git status`, HEAD, active work, and applicable instructions. The authoring worktree had concurrent C2/persistence/domain changes; never assume it is safe to overwrite those files.
- Create an execution record below with exact base revision, dirty-file ownership, available runtime/services, and tool versions. Do not copy the authoring SHA as the implementation base.
- Freeze each shared helper's input/output/error contract before a caller-migration agent starts.
- Use one writer per original file. Domain files such as `expenses.rs`, `payroll.rs`, and `purchase_orders.rs` occur in several tasks; serialize those tasks even if their functions are unrelated.
- Reserve root wiring, exports, manifests/lockfiles, workflow files, generators, plan/ledger, and shared files for the coordinator unless explicitly transferred.
- Start with at most two independent implementation agents. Increase only when review capacity and file ownership permit. Never exceed the tool's actual slot limit or dispatch merely to fill slots.
- Reserve one Cargo/codegen/build slot. Lightweight disjoint read-only inspection or focused JS/Python tests may run concurrently when they do not generate shared outputs.

### Work assignment template

```text
Task ID / class (E, V, S, I) / objective:
Accepted prerequisites and base revision:
Allowed original files:
Allowed destination files:
Coordinator-reserved exports/wiring and other active owners:
Functions/types/callers covered:
Contract decision IDs, including null/error/scope/default behavior:
Explicit behavior correction allowed, or "none":
Required tests and disqualifying regressions:
Permitted commands; Cargo/build slot ownership:
Handoff: actual diff, source-to-owner map, callers migrated, remaining copies
with reasons, test results/counts/skips, requested wiring, risks/blockers.
Do not broaden scope, add dependencies, format the repo, commit, push, or
modify another owner's files. Return conflicts to the coordinator.
```

### Integration loop

1. Read the actual patch and surrounding callers. A model's summary is not review evidence.
2. Verify the behavioral contract and all moved branches, checks, tests, and important explanatory comments have destinations.
3. Review credential/client choice, scope checks, null/number behavior, transaction boundaries, and protocol bytes where applicable.
4. Integrate declarations, explicit imports/exports, package exports, test discovery, source-scanning tooling, and documentation.
5. Search for old helper definitions and bypassing callers. Record intentional survivors with their reason; do not force duplicate count to zero across legitimate boundaries.
6. Run required checks on the integrated tree. Passing isolated agent tests are not sufficient.
7. Accept, or return a bounded correction request. Release ownership before starting a dependent task.

If the executor lacks subagents, use this same loop sequentially. If an agent is interrupted, inspect its partial diff before reassignment. Never let two agents repair the same partial extraction.

## 6. Task graph and scheduling

Every task begins with source/caller refresh and ends with integrated acceptance. `PLANNED` means no implementation claim.

| Task | Deliverable | Dependencies | State |
| --- | --- | --- | --- |
| D00 | Current inventory, baseline, ownership ledger | None | PLANNED |
| D01 | Behavioral contracts and interface decisions | D00 | PLANNED |
| D10 | Strict ID parsing and caller migration | D01 | PLANNED |
| D11 | Row/timestamp contracts and audit helper adoption | D01; D10 for shared numeric parsing | PLANNED |
| D12 | Contact normalization parity | D01 | PLANNED |
| D13 | CSV parsing contract/parity | D01 | PLANNED |
| D20 | Accounting/tax/analytic relation ownership | D01 | PLANNED |
| D21 | HR/subscription relation ownership | D01 | PLANNED |
| D22 | Journal-line constructor ownership | D20; serialize overlapping D21 files | PLANNED |
| D23 | FX metadata ownership | D20/D22 where source files overlap | PLANNED |
| D24 | Workflow receipt ownership | D01 | PLANNED |
| D25 | Integration-worker lifecycle | D01 | PLANNED |
| D30 | AI route helper adoption and preparation | D10/D11 decisions applicable to routes | PLANNED |
| D31 | Rust wire decoder ownership | D01; coordinate API M20 before paths move | PLANNED |
| D32 | Canonical JSON deduplication | D01; cold-tier move order fixed by coordinator | PLANNED |
| D33 | Identifier/case conversion contracts | D01; coordinate D31/D32 source ownership | PLANNED |
| D34 | Navigation catalog and presentation adoption | D01 | PLANNED |
| D35 | Shadow HR policy/AI registry disposition | D00/D01 | PLANNED |
| D36 | HTTP error/auth boundary cleanup | D01; coordinate M10/M11/M21/M60 | PLANNED |
| D37 | Warning/stub/PDF disposition | D00/D01 | PLANNED |
| D40 | Existing API modularization M-task execution | D00/D01; per-module prerequisite gate below | PLANNED |
| D41 | Frontend hook/utility segmentation | Relevant D10/D11/D30/D34 acceptance | PLANNED |
| D42 | Bounded domain wave-file segmentation | Relevant D20–D24 acceptance | PLANNED |
| D50 | CI/E2E setup consolidation | D00; tooling path inventory from D40–D42 | PLANNED |
| D60 | Ownership checks, documentation, discovery checks | Each relevant family accepted; incremental | PLANNED |
| D90 | Final integrated verification and handoff | All required tasks accepted | PLANNED |

Suggested waves, not permission for file conflicts:

1. D00/D01: coordinator establishes evidence and decisions; no extraction until interfaces are settled.
2. D10 and D20 can run in parallel. D12/D13 are alternate disjoint assignments as review capacity permits.
3. D11/D30 follow numeric contracts. D21/D22/D23 are serialized by their actual domain file overlaps. D24/D25/D34 are useful independent lanes.
4. D31/D32/D33/D35/D36/D37 run in bounded batches; persistence and source-scanning changes require coordinator ownership.
5. D40 proceeds module by module after that module's overlapping helper task is accepted. D41/D42 follow their own accepted owners, not necessarily all D40.
6. D50 and incremental D60 complete with final moved paths. D90 validates the final combined tree.

D40 is not blocked on every unrelated frontend task. Conversely, a cold-tier extraction cannot race D32/D33 in the same source file. The coordinator writes the chosen local order into the ledger before dispatch.

Track partial tasks as `active`, not `accepted`. Use `review` after implementation
handoff, `accepted` only after integrated gates, and `blocked` with a concrete
missing prerequisite. A `deferred` item needs an explicit scope decision and
must remain visible in the final report. Reusing accepted companion-plan work
requires an evidence reference, not another implementation or an unchecked tick.

## 7. Detailed work packages

### D00 — Baseline and inventory

- Record HEAD/branch, clean vs pre-existing modified/untracked files, active owners, service endpoints without secrets, and available test infrastructure.
- Inventory each F-family: definitions, direct and indirect callers, public exports, generated consumers, inline tests, test-only helpers, and source-inspecting scripts.
- Establish baseline test discovery and focused results in the permitted single build slot. Do not run the whole stack for this inventory.
- Capture existing failures/warnings with command, target, feature set, and revision. A pre-existing failure is not waived indefinitely; it remains a clearly named final verification blocker.
- Read the companion plan's corrections and destination map. Identify source scanners that depend on paths/function layout before any move.

Acceptance: every F01–F22 has a current class and task; disputed claims are corrected; dirty-file ownership is recorded. No claim is accepted solely from a compiler warning or text-clone score.

### D01 — Contracts and decision records

For each V/S family write a short record in the execution log: current variants/callers, accepted contract, intended correction, compatibility adapters, test vectors, and owner. Keep these records concise and testable.

Decisions that must precede migration:

- ID grammar/range, whether zero is meaningful per caller, absent vs invalid, and how errors reach forms/HTTP.
- Timestamp units/representations per input source, invalid-date handling, pre-epoch support, and display fallback.
- Field alias precedence and null-clear vs fallback semantics.
- CSV quoted headers, whitespace/blank rows, row-number correspondence, malformed quotes, embedded newlines, and input size units.
- Compatibility for API error envelopes/status codes, intentional hash differences, identifier dialects, and dormant public exports.

A demonstrated invalid ID must not silently change to another valid ID. Other uncertain product semantics, such as whether a proposal stub should return a service error or a labeled development response, require user direction before that behavior is changed. Independent structural work can continue.

### D10 — Exact, bounded ID parsing

Sources: `frontend/packages/erp-shared/src/form-coercion.ts`, scalar helpers in `frontend/packages/query-hooks/src/hooks/{hr,pos,auth}.ts`, AI-route integer helpers, and callers found by D00.

1. Inspect existing generated wire codecs and scalar contracts before creating a new parser. Keep the new pure form/upper-layer parser distinct from generated transport types.
2. Parse integer strings directly to `BigInt`. Validate `0 <= n <= 18446744073709551615`. Accept JS numbers only when safe integers and in range. Do not round or truncate IDs.
3. Keep positive-ID validation as a separate caller policy; zero is not globally forbidden. Keep absent values distinct from invalid values. Preserve supported Option input adapters explicitly.
4. Use an explicit error/result shape consistent with the surrounding layer. Avoid invalid-to-undefined conversions that silently substitute another company/account from context.
5. Migrate callers in small groups, including arrays/delimited IDs and `nullableBigIntU64` wrappers. Leave monetary/general numeric coercion alone.
6. AI endpoints using numeric contracts must reject values outside their representable contract, not stringify or change the endpoint schema incidentally.

Required vectors: 0, 1, max u64, max+1, negative, fraction, unsafe JS number, decimal string above 2^53, whitespace, empty, null, undefined, supported Some/None envelopes, scientific notation, `12suffix`, grouped strings if currently supported, arrays and patch-clear cases. The `9007199254740993` string must remain exact.

Acceptance: callers no longer contain competing strict ID parsers; errors do not select fallback business IDs; generated params remain unchanged; relevant form/hook/web tests and typechecks pass. Document any intentionally retained permissive non-ID parser.

### D11 — Field access, timestamps, and audit adoption

Sources: `entity-row-utils.tsx`, `stored-dashboard-resolver.ts`, proposal row helpers, `audit-log-utils.ts`, settings audit log, record audit tab, and existing `erp-shared/src/stb-timestamp.ts`.

- Separate row property lookup from value decoding. Prefer explicit operations such as first-owned-key (preserves null) and first-non-null-key rather than a global normalize-everything function.
- Record behavior when both aliases exist with different values, including explicit null and inherited properties. Keep update patches out of generic fallback processing.
- Decode timestamp sources through named millisecond/microsecond/ISO/SDK-object adapters; keep outbound reducer timestamp construction separate. Preserve microsecond arithmetic until the intentional Date precision boundary.
- Do not change every number to milliseconds or preserve heuristic guessing as an undocumented universal contract. For legacy ambiguous inputs, retain a named compatibility adapter until producer evidence resolves them.
- Finish settings audit adoption of the existing utility. Preserve settings-specific detail prefixes and the record tab's different presentation.

Tests: alias collisions; null/undefined/false/zero/empty; Date, ISO, numeric milliseconds, numeric microseconds, supported SDK wrappers, invalid dates, range/overflow, and pre-epoch inputs where supported. Test both UI consumers. Do not assert a current audit production bug without tracing its producer.

Acceptance: pure decoding no longer requires importing React components; no lower-package dependency cycle; audit timestamps/details preserve the agreed contract; intentional adapters are named and tested.

### D12 — Contact matching consistency

Sources: `frontend/web/lib/{contact-duplicate-detection,import-duplicate-detection}.ts`, with parity reference `spacetimedb/src/crm/duplicate.rs`.

- Extract pure normalized name/email/phone primitives. Fix blank-phone/mobile fallback consistently for the common contact case.
- Preserve import-only vendor and external-reference matching, merge active/deleted filtering, company filtering, output ordering, and display labels.
- Keep server merge authorization and mutation validation independent. Frontend suggestions are not permission to merge.
- Add shared behavior fixtures usable by frontend tests and an equivalent Rust test where feasible; do not import frontend code into reducers.

Tests: blank/whitespace/null phone with mobile; case-normalized email; conflicting aliases; duplicate IDs; deleted/merged contacts; cross-company input; vendor-only and external-ref cases. Do not add phone-number canonicalization semantics such as country-code inference in this task.

Acceptance: the demonstrated common-case mismatch is fixed, intentional match-policy differences are retained, and existing CRM merge E2E coverage remains discoverable.

### D13 — CSV contract and parity

Sources: `spacetimedb/src/data_ops/helpers.rs`, `ai-gateway/src/skills/import.rs`, and `frontend/packages/erp-shared/src/csv-import-{safety,transform,bundles,retry}.ts`.

- Characterize the row splitter separately from parser/header normalization and AI size/safety policy.
- Make quoted-header handling consistent where the same CSV enters preview and import. Preserve canonical header normalization as a named reducer/import step, not a side effect of a shared tokenizer.
- Choose and document blank-line and row-number policy; frontend retry/error mapping must still identify the actual imported row.
- Existing line-by-line parsers do not establish support for multiline quoted fields. Either reject unsupported input clearly or implement support as a separately reviewed contract change; never silently corrupt it.
- Evaluate existing dependencies before proposing a parser dependency. No new cross-workspace crate merely to save 27 lines. If code cannot sensibly be shared across runtime/language boundaries, retain small adapters with one documented contract and parity fixtures.

Tests: quoted commas/headers, escaped quotes, CRLF, trailing newline, blank rows, spaces, empty cells/header, malformed/unclosed quotes, embedded newline disposition, Unicode and size limits, formula-safety checks, canonical export/import round-trip and retry row numbering.

Acceptance: supported inputs have equivalent parse structure across preview/import; safety and size checks are preserved; intentional header transformations are explicit; no new dependency without recorded justification.

### D20 — Accounting/tax/analytic relation owners

- Reuse `accounting/relations.rs::require_active_account` for proven equivalent FX validation.
- Extract the matching duplicate tax-list validation from `chart_of_accounts.rs` and `tax_management.rs` into that owner. Preserve error text/order and duplicate-list rejection where externally observable.
- Move matching analytic-account checks from projects, expenses, and purchasing to an accounting/analytic-owned helper. Preserve None/clear behavior and active/org/company checks.
- Do not replace company-only payroll/expense account validators with stronger checks as a mechanical edit. Record their policy difference and preserve or separately approve any tightening.

Tests: absent/deleted/deprecated/inactive resources as applicable; wrong organization; wrong company; duplicate IDs; valid paths; optional absent/clear/update behavior. Use persisted reducer tests for tenant/business invariants, not only mocks.

Acceptance: each equivalent rule has one production owner; all covered callers use it; typed table access remains; no generic FK repository or cyclic domain imports.

### D21 — HR/subscription relation owners

- Extract the four equivalent employee-scope checks into `hr/relations.rs`.
- Preserve `global_assignment.rs` organization-only lookup and its returned company information. Do not make cross-company assignments impossible by substituting the stricter helper.
- Consolidate subscription D/E loaders into `subscriptions/relations.rs`, preserving return type, error order, and org/company checks.
- Move no tables/reducers in this task. Coordinate exports with the module root owner.

Tests: valid, not found, wrong org/company; global-assignment cross-company behavior; subscription use in billing/dunning/usage callers. Acceptance requires migrated callsites, not just newly exported helpers.

### D22 — Journal-line constructors

Sources: `hr/payroll.rs`, `expenses/{expenses,expense_depth,expense_wave_d}.rs`, `purchasing/purchase_returns.rs`, `subscriptions/billing_helpers.rs`.

- Group constructors by actual field/default equivalence; the four-copy family and the second pair need not collapse into one default profile.
- Build on canonical `AddAccountMoveLineParams`; do not redeclare it, attach a blanket Default derive to generated types, or hide business choices in dozens of optional arguments.
- Extract one or a small number of explicitly named accounting-owned constructors, then keep domain-specific field overrides visible near posting orchestration.
- Keep transactions, permissions, tax/currency decisions, and balancing logic at their existing owners.

Tests: complete field-by-field old/new equivalence for each profile, debit/credit/zero cases, quantity and price defaults, sequence, taxes/analytic values, plus representative payroll, expense, advance, return, and subscription posting tests. No “close enough” JSON snapshot that omits default fields.

### D23 — FX metadata

- Extract the matching sales/purchasing metadata merge into a pure narrow owner.
- Preserve existing-object keys, overwritten FX keys, malformed/non-object/absent metadata behavior, exact number/time representation, and serialization behavior.
- Do not change exchange-rate lookup, selected rate, or currency precision.

Tests: None, valid object with unrelated keys, existing FX keys, invalid JSON, scalar/array JSON, and rate/timestamp edge cases. Migrate both producers and verify their consumer expectations.

### D24 — Workflow receipts

- Extract equivalent runtime/migration `replay_receipt` lookup and conflicting-input rejection into `workflow/receipts.rs` with the narrowest visibility needed.
- Preserve scope-key construction, transaction context, lookup-before-mutation order, command-specific input hashes, receipt insertion, and exact-retry behavior.
- Do not combine runtime and migration state machines or change canonical input framing.

Tests: no receipt, exact retry, conflicting hash, distinct scoped keys, and existing persisted runtime/migration retries. Retain crash/replay tests and inspect actual production sequencing independently of fakes.

### D25 — Integration-worker lifecycle

- Inventory expense/HR/project configuration keys, defaults, health routes/statuses, organization enumeration, poll timing, batch behavior, and error handling.
- Extract only the proven common serve/poll/readiness lifecycle. Keep each domain's reducer dispatch explicit and typed where currently supported.
- Preserve startup readiness transitions, error recovery, per-organization ordering, batch limits, shutdown/task ownership, and logging domain labels.
- Do not change sequential work to concurrent work or absorb workflow outbox/projection workers into the abstraction.

Tests: config/default mapping per worker; successful and failed ticks; organization sequence; readiness transitions; retry cadence and shutdown using controlled time where practical. Compile all worker binaries, not only the API library.

### D30 — AI HTTP boundary

- Reuse existing `route-helpers.ts` for context, JSON-object validation, company scope, and JSON proxy behavior after explicitly checking compatibility.
- Extract shared form field sanitization into `form-request.ts`; extract common RAG preparation into `rag-request.ts`.
- Keep endpoint-specific fields, raw-text/document-job requirements, route-specific limits, and stream-only agent/team selection explicit.
- Keep SSE headers, streaming/cancellation, and token forwarding in its transport adapter. Do not pass streaming responses through a buffered JSON helper.
- Where adopting object-body validation changes old malformed-body behavior, record that correction and add negative HTTP tests. Preserve session-owned org and validated company; no trusted client-supplied org.

Tests: no session/org, wrong company, invalid JSON, null/array/scalar body, strict IDs, duplicate/unsupported fields, label/option/pattern/length limits, gateway non-JSON/error/status behavior, stream headers/cancellation, and non-stream response contract. No secrets in fixtures/logs.

### D31 — Rust wire decoding

- Inventory `row_u64`, `optional_u64`, `u64_field`, identity helpers, and case converters across API, AI, and `stdb-client`, including callers that rely on strict errors vs optional absence.
- Reuse canonical/generated transport codecs where they cover the actual input format. Keep query-specific error/status adapters local.
- Eliminate exact AI copies first. Review signed-to-unsigned casts, overflow, string parsing, malformed identity bytes, and Option envelope differences as separate correctness decisions.
- A common primitive must not silently normalize malformed data to zero/None or choose an organization/company.
- Initially preserve the modularization plan's `query_exec/row_values.rs` facade if moving the lower owner would otherwise entangle file extraction. The facade delegates; it does not retain an independent algorithm.

Tests: scalar and string limits; negative signed inputs; overflow; null/missing; exact supported Some/None envelopes; alias collision; valid and malformed identities. Add parity fixtures per actual source encoding rather than claiming all JSON-looking values are one protocol.

Acceptance: agreed common transport behavior has one owner per sensible runtime boundary; adapter differences are named and tested; source/error context remains available; no contract/schema changes.

### D32 — Canonical JSON

- Capture literal golden canonical bytes and final hashes from current valid fixtures before extraction. Include nested maps, ordering, Unicode, escapes, numbers, null, and arrays.
- Within cold-tier and AI respectively, share only proven equivalent recursive canonicalization. Preserve error propagation and intentional fallback behavior unless a separate correction is approved.
- Retain UUID-v5 vs SHA-256, prefixes, namespaces, length framing, row/table/commit digest structure, and array order. Existing tests that only compare two outputs from the new helper are insufficient.
- Do not create service dependencies in `spacetimedb/src/core/persistence.rs`. Keep cross-universe equivalence tested; a future shared pure crate requires separate dependency/provenance justification.

Acceptance: stored protocol outputs are byte-identical for supported inputs; no ledger/receipt invalidation; projection/reconstruction gates run when their runtime paths change. Coordinate sequencing with M31/M32/M33, never edit the same source simultaneously.

### D33 — Identifiers and case conversion

- Inventory PG quoting, STDB SQL identifier/literal handling, generated-name conversion, and relation suffix rules separately.
- For PG, choose a validated identifier seam appropriate to actual generated names. Validation must occur in release builds at the required boundary; a debug assertion is not a new validation guarantee.
- Preserve valid existing manifest names. Tightening an accepted grammar needs fixture/provenance evidence, not aesthetic preference.
- Name different conversions by their source semantics where they intentionally differ. Do not merge a CamelCase type-name converter with parameter-field conversion that handles M2O/M2M/O2M.

Tests: lower/digit/underscore boundaries, leading characters, length, quoting/control/non-ASCII rejection as specified, acronyms, digits, relation suffixes, already-snake names, and generated fixtures. No new schema names or hashes as an incidental outcome.

### D34 — Navigation

- Extract sidebar/command palette shared groups, translated labels, paths, icons, and permission resources into one UI-local navigation catalog.
- Keep the two presentations' state, actions, badges, shortcuts, collapse behavior, and ordering rules separate.
- Preserve translation keys and role filtering; frontend visibility remains presentation, not backend authorization.

Tests: both surfaces consume the same intended links/resources/order; allowed/denied roles, translated labels, and special action items. Do not build a plugin registry or move icon-bearing configuration into a lower pure package unnecessarily.

### D35 — Shadow definitions

For each HR policy and AI registry surface, produce a disposition record: current direct/indirect callers, package exports, external compatibility expectations, live vs test use, and final owner.

- Retain independent enforcement at HTTP and reducer boundaries. Shared policy data does not replace the second check.
- For unused module-side predicates, remove only after proving callers/export obligations; do not delete used constants or the PII audit reducer/table alongside them.
- For the TS AI registry, absence of a direct search hit is not proof no external consumer exists. Inspect package exports and consumer boundaries. Retire obsolete internals, preserve a documented compatibility export if needed, or derive both required outputs from one reviewed source.
- If two runtime/language consumers genuinely remain, use a small neutral policy/specification source with validation or parity tests. Do not create a second global resource registry; the existing canonical registry already owns resource identity.

Tests: HR allowlists/redaction/audit behavior, live AI snapshot scope and permitted prompt fields, registry keys and consumer exports. Record deliberate cross-boundary duplicates in the ownership documentation.

### D36 — HTTP errors and session preambles

Record two acceptance parts: error handling and extractor/caller adoption. The
extractor part is fulfilled through M60 after M10/M11/M21, not a second extractor
implementation. D40 can establish those boundaries before this part completes;
do not create a circular prerequisite requiring all of D36 before all of D40.

- Preserve the HTTP status/body contract unless an explicit security/redaction correction is recorded. Keep response rendering centralized.
- Preserve source errors internally using an appropriate error representation, not merely a derive on `Internal(String)`. Map errors at boundaries with context; do not assume transitive `From` conversions.
- Do not classify every database/reducer error as retryable. Preserve existing client-error classification; audit broad Internal mappings individually.
- Redact internal response details only through a reviewed contract change with tests; logs retain source/context without leaking secrets. A transparent error derive must not make confidential source messages public.
- A session extractor delegates to current resolution and `require_org`, preserves credential precedence, and obtains no privileged client or default company implicitly.
- Migrate a small representative handler group, verify, then migrate remaining equivalent callers. Leave distinct auth flows explicit.

Tests: unauthorized/forbidden/auth-special variants, expected status/body, internal redaction/log context, cookie/bearer precedence, missing org, wrong company, and handler rejection behavior. No public-library `non_exhaustive` or variant redesign solely for stylistic consistency.

### D37 — Warning, stub, and fallible-rendering disposition

- Refresh warnings by build target and search test callers. Move test-only support under appropriate test configuration rather than deleting it.
- For unused DTO fields, inspect SELECT/deserialization requirements and compatibility before dropping them; removing a required parsed field changes what inputs can decode.
- Investigate credential lookup and report getter callers/exports before removal. Remove unused imports/unreachable patterns only after confirming their actual semantics.
- Keep proposal mock behavior as a tracked decision: fail explicitly, gate to development, or label a supported degraded result according to user-approved behavior. Do not remove a mounted endpoint without a replacement contract.
- Replace only recoverable PDF-path panics with errors after checking the renderer API. Preserve document output/content type and log useful context. Programming invariants in catalogs/resource mappings are not automatically erroneous `expect` usage.

Acceptance: each earlier “ghost/dead/stub/panic” claim has a corrected disposition and evidence; no test loss or blanket warning suppression; any unresolved product choice remains an explicit blocker, not silently marked complete.

## 8. Structural work after owners settle

### D40 — Execute the existing API M-plan, do not duplicate it

Adopt the companion plan's M-task ledger and full destination map. D40 is an umbrella status referencing those accepted tasks, not a second implementation.

| Source group | Required overlap resolution before extraction |
| --- | --- |
| `query_exec.rs`, `workflow_reads.rs` | M01 dispatch audit repair; D31 decoding contract and one agreed move order; scope policies remain distinct |
| `http_app.rs`, `routes/auth.rs` | Agree D36 error work vs M10/M11 order; extractor adoption follows M60 prerequisites; preserve middleware/auth wiring |
| `cold_tier/mod.rs` | M30 shared-root conversion accepted before child conversions |
| `commit_projection.rs`, `projection_worker.rs`, `reconstruction.rs` | Agree D32/D33 order; retain sole transaction/fence owners and protocol golden tests |
| `workflow_worker.rs` | D37 test-helper disposition; keep outbox state machine separate from D25 polling reuse |
| `reports/{service,render}.rs`, `routes/documents.rs` | Preserve typed aggregation/rendering boundaries; separate D37 behavior correction from file moves |
| CRM/platform/realtime | Preserve public seams and generated callback/source-scanner wiring from M-plan |

Rules for every source-file conversion:

1. Inventory the original functions/types/tests and map each to a destination; no orphans.
2. Give the original file to one owner. Establish module skeleton before parallel child ownership.
3. Avoid simultaneous `name.rs` and `name/mod.rs`; wire the conversion coherently.
4. Keep existing public entry points through explicit re-exports when compatible. Do not churn every import gratuitously.
5. Split orchestration from pure preparation/decoding and domain policy, not into generic type-based bins.
6. Keep tests with private owners or integration boundaries as appropriate; verify discovery after movement.
7. A small facade is acceptable; an unchanged thousand-line match/function moved into another filename is not a successful segmentation.

### D41 — Frontend hotspot segmentation

Scope is the affected hook/utility families, not a frontend rewrite. D00 records measured size, independent responsibilities, consumers, and a concrete slice map for each selected file.

Initial candidates: `frontend/packages/query-hooks/src/hooks/{hr,inventory,accounting}.ts` and the row/audit/navigation areas already assigned above.

Preferred feature-owned layout, adapted to actual exports:

```text
query-hooks/src/hooks/hr/
  index.ts          explicit compatibility exports
  employees.ts      employee/department/job hooks when cohesive
  leave.ts          leave lifecycle hooks
  payroll.ts        payroll/contracts/payslips, split only if needed
  onboarding.ts     onboarding/offboarding hooks
  benefits.ts       benefit hooks
  imports.ts        HR CSV import entry points
```

Inventory/accounting follow their real subdomains (for example products/stock operations and accounts/journals/moves/budgets), not arbitrary numbered chunks. Record exact assignments before extraction; do not create empty files for hypothetical features.

- Preserve hook names/signatures, generated input/output types, query keys, `enabled`, initial-data behavior, stale times, company/session context, mutation side effects, and invalidation sets.
- Keep command/HTTP transport delegation intact. Similar mutation hooks do not justify a generic hook factory if their invalidation or validation differs.
- Coordinate `hooks/hr.ts` vs `hooks/hr/index.ts` resolution and barrel exports; do not leave ambiguous dual entry points.
- New tests must be included by package scripts: the existing query-hooks glob covers only `src/hooks/*.test.ts`, not arbitrary nested test directories.
- Audit UI/demo configuration duplication separately. The two dashboard configuration files have different demo/presentation content; do not combine them on clone similarity alone.

Acceptance: per-feature changes are locally navigable; callers retain behavior; test discovery/typechecks pass; consumer examples and ownership map identify the canonical helper/hook location.

### D42 — Bounded reducer-domain segmentation

Start with the files actually touched by relation/construction work. Do not convert the entire standalone module into domain crates.

For `subscriptions/subscription_wave_d.rs`, candidate cohesive owners are usage ingestion/rating, pricing tiers/commitments, and bundles. For `subscription_wave_e.rs`, candidates are collections/dunning, entitlements, payment/tax intents, index-linked renewal, and deferred-schedule integration. The coordinator confirms exact blocks and existing module-name collisions before assigning a slice.

- Prefer business-capability names over historical wave labels. Preserve old Rust paths by re-export where needed, not duplicate reducer declarations.
- Move tables/types/reducers only as supported by source-scanning/codegen and SpacetimeDB registration. If moving them would change schema/type/reducer metadata, stop and revise the extraction boundary.
- Preserve commit/change-log coverage instrumentation and concurrent tenant-ownership work. Never discard new instrumentation while relocating an older copy.
- Extract payroll/expense/purchasing orchestration only when D00 identifies separable responsibilities after shared helpers migrate. Do not mandate another large rewrite merely to meet a line target.

Acceptance: selected file slices have a complete responsibility map, unchanged schema/operation identity, retained persisted domain tests, and verified generation/source-scanner coverage. Unselected candidates are documented as investigated/deferred, not silently presented as completed refactors.

## 9. DX, guardrails, and final acceptance

### D50 — Consolidate remaining setup without weakening CI

- Reuse the implemented fingerprint/build helpers. Inventory repeated E2E service startup/wait/cleanup and retain mode differences explicitly.
- For CI, extract repetitive SSH/frontend setup only where input, trust, and cache behavior genuinely match. Keep permissions, secrets availability, event/path selection, and required-gate logic visible at workflow level.
- Preserve fail-closed selection for unknown/mixed/shared/build/workflow/schema/lockfile changes, scheduled/manual behavior, and fork-PR secret restrictions.
- Validate shell failure propagation, readiness waits, cleanup ownership, cache invalidation on failure, `.next/BUILD_ID`, and CI's mandatory builds.
- DX7 semantic-index check overlap is removable only after event-by-event equivalent coverage is demonstrated. Reusable YAML alone does not remove duplicated runs or justify a speedup claim.
- DX2–DX6 remain separately gated work. Artifact sharing, E2E parallelism, compile-boundary changes, and runner tuning do not become authorized merely because this plan consolidates setup.

Acceptance: workflow/setup contract matrix, classifier/helper tests, syntax/lint checks, before/after required-job coverage, and operational guide updates. Report configuration reduction separately from measured duration/runner-minute changes.

### D60 — Make ownership discoverable and prevent reintroduction

- Add a concise reference guide, suggested `docs/guides/code-ownership-and-shared-behavior.md`, mapping each completed family to its owner, adapters, tests, and intentional exclusions. Link it from this plan and the relevant existing guides.
- Add module-level docs explaining scope/error/units/defaults where non-obvious; examples should show the intended import, not a freshly reimplemented helper.
- Extend existing lint/ratchet infrastructure where suitable. For selected high-value retired definitions, a narrow explicit regression check can prevent reintroduction. Test the check with a deliberate duplicate fixture and legitimate wrapper/adapter fixtures.
- Do not deploy a blanket repository-wide clone-percentage gate. Generated code, tests, transport boundaries, and small adapters need different treatment.
- Validate newly nested test discovery and update explicit test lists/package exports/source scanners. A passing suite that never discovers the new regression tests is a failure of this task.
- Record each intentional duplicate: owner of its behavior contract, why sharing is unsuitable, and the parity test or compatibility reason keeping it safe.

### Validation commands and cautions

Confirm actual scripts/targets at D00. These commands are examples grounded in the authoring tree, not a requirement to run all of them per patch.

| Area | Focused path | Broader required evidence when affected |
| --- | --- | --- |
| Shared TS | From `frontend`: `pnpm --filter @lumiere/erp-shared test` and `typecheck` | Hook/STDB/web consumers after shared contract changes |
| Hooks | From `frontend`: `pnpm --filter @lumiere/query-hooks test` and `typecheck` | Relevant web tests and affected browser flow; confirm nested discovery |
| UI | From `frontend`: `pnpm --filter @lumiere/ui test` and `typecheck` | Affected consumer rendering/navigation/audit flow |
| Web | From `frontend`: `pnpm --filter ./web test:unit` and `typecheck` | Production build when exports/server-client boundaries/build inputs change |
| API/AI | Root: `cargo check --locked -p api-server -p ai-gateway`; focused library/module tests from discovered list | All touched binaries and integrated suites after final wiring |
| Source audit | Root: `cargo test --locked -p lumiere-codegen query_exec_audit` | Generator/path/source-scanner coverage after Rust moves |
| Reducers | `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests` | In-module persisted domain tests against a designated local test database with the changed code deployed |
| PG/fences | Existing cold-tier tests; see M-plan's environment-gated matrix | Actual designated-test-DB transaction matrix/recovery coverage, not a skipped early return |
| CI/DX | Existing Python/helper tests, shell syntax, Make dry-runs, workflow lint | Trigger/gate matrix and relevant branch CI results |

Important safety and accuracy rules:

- `make test` depends on `publish-clear` in the authoring tree. Do not run it as an ordinary unit test; it clears a database. Inspect the exact target and require explicit disposable-target authorization for destructive fixtures.
- Native `cargo check --tests` or `cargo test` does not prove in-module reducer tests executed in SpacetimeDB. Record actual test reducer, target database, deployed code identity, and result.
- Test reducers can mutate fixture data. Use designated test data/targets, not a live user database.
- Use `make e2e-single-running` only when its services/fixtures actually match the tested source. API/reducer changes may require the relevant rebuild/deploy; do not test stale binaries to preserve a fast-path claim.
- `make check-codegen` performs generation and index-related operations. Inspect it and use a suitable validation checkout; do not run it blindly in another owner's dirty worktree.
- The final graph checks must cover root services and standalone reducers. Structural moves are expected not to require a schema/contract release; unexpected drift is a stop signal.
- An empty test filter, disabled opt-in integration gate, interrupted build, or unavailable service is not a pass. Record discovered/executed counts and skips.
- Reuse caches; avoid competing Cargo processes and repeated full frontend builds for pure helper changes. Do not claim a full-stack pass from focused tests.

### D90 — Integrated definition of done

The coordinator must inspect the final combined diff and provide evidence for all of the following:

- [ ] F01–F22 have accepted implementation or an explicit, justified user-approved disposition; candidates/shadows are not mislabeled as fixed.
- [ ] Demonstrated ID/contact inconsistencies have regression tests and agreed corrected behavior; timestamp/CSV/alias contracts are explicit.
- [ ] Equivalent production copies covered by each task are removed or delegate to one owner; intentional adapters are documented.
- [ ] Canonical generated types, tenant/company authority, HTTP/wire identity, hash protocols, and transaction/fence semantics remain intact.
- [ ] Selected god-file conversions have cohesive destinations, narrow facades, complete old-to-new maps, and no replacement catch-all modules.
- [ ] All agent contributions were reviewed and integrated; no unresolved imports, manifests, exports, source scanners, or test-discovery wiring remain.
- [ ] Focused tests passed on the integrated tree; final affected service/TS/domain/PG/browser gates ran as required. Missing required infrastructure is reported as a remaining blocker.
- [ ] Baseline failures and introduced regressions are distinguished; no new warning suppression, disabled tests, or weakened CI selection hides problems.
- [ ] Documentation, ownership reference, and both companion execution ledgers accurately distinguish completed, deferred, and blocked work.
- [ ] Unrelated dirty files and concurrent changes remain preserved; generated changes are explained and reviewed.
- [ ] Final handoff identifies accepted tasks, remaining risks, exact verification, and any publication/merge step requiring separate authority.

Do not label the entire plan complete if a required task is merely implemented but unreviewed, integrated but untested, or deferred without approval.

## 10. Execution ledger and resumption protocol

Update this section during execution; keep long logs outside the document and link concise evidence. The checked task states above must match the records here.

### Current execution state

- Implementation base: not established.
- Active tasks/owners: none assigned by this document.
- Cargo/codegen slot: not reserved by this document.
- Accepted tasks: none.
- Next action: D00 current-tree inventory and baseline.

### Per-task record template

```text
Task / finding IDs / status:
Owner / coordinator reviewer:
Base revision / integrated revision or scoped patch identity:
Allowed files / actual changed files:
Old functions and callers -> final owner:
Decision IDs / intentional behavior changes:
Copies removed / remaining adapters and reasons:
Tests discovered / executed / passed / failed / skipped:
Commands, target/feature/environment gates, concise evidence:
Baseline failures vs regressions:
Review findings and resolutions:
Exports / source scanners / test lists / docs updated:
Blocker or acceptance rationale:
Next executable task:
```

### Decision record template

```text
Decision ID / family:
Current variants and affected callers:
Accepted input/output/error/scope behavior:
Correction vs compatibility-preserving extraction:
Alternatives rejected and why:
Compatibility/rollout concerns:
Required fixtures and consumer gates:
Approver (coordinator within explicit scope, or user for product decisions):
```

### Session handoff

Before stopping or handing to another model, record the actual branch/revision, task states, active owners and partial files, build slot/process state, unresolved decisions, last successful tests, exact blockers, and one next executable task. Preserve the ledger as the resumption point; a new session must not restart extraction from the original historical file layout.

Keep each accepted task in a small reviewable patch/commit when authorized. Separate behavior corrections, helper adoption, and file movement so they can be reviewed or reverted independently. Do not implement rollback with destructive checkout/reset commands over a shared dirty tree; reverse only the identified owned patch, with coordinator review and appropriate authorization.
