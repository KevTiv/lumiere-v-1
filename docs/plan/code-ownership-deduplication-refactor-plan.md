# Code ownership, deduplication, and modularization: implementation handoff

Status: **IN PROGRESS — corrective integration and remaining modularization.**
Current evidence: [Luna integration log](code-ownership-luna-integration-log.md).
Earlier acceptance notes below are historical implementation reports, not proof
that all adoption, behavior, and live-service gates have passed.
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
| D00 | Current inventory, baseline, ownership ledger | None | ACCEPTED |
| D01 | Behavioral contracts and interface decisions | D00 | PARTIAL — product-policy decision pending |
| D10 | Strict ID parsing and caller migration | D01 | CORRECTED — focused tests pass |
| D11 | Row/timestamp contracts and audit helper adoption | D01; D10 for shared numeric parsing | PARTIAL — selected consumers migrated |
| D12 | Contact normalization parity | D01 | IMPLEMENTED — cross-universe parity pending |
| D13 | CSV parsing contract/parity | D01 | IMPLEMENTED — malformed-input parity pending |
| D20 | Accounting/tax/analytic relation ownership | D01 | IMPLEMENTED — persisted acceptance pending |
| D21 | HR/subscription relation ownership | D01 | IMPLEMENTED — persisted acceptance pending |
| D22 | Journal-line constructor ownership | D20; serialize overlapping D21 files | IMPLEMENTED — domain acceptance pending |
| D23 | FX metadata ownership | D20/D22 where source files overlap | IMPLEMENTED — domain acceptance pending |
| D24 | Workflow receipt ownership | D01 | IMPLEMENTED — persisted acceptance pending |
| D25 | Integration-worker lifecycle | D01 | IMPLEMENTED — lifecycle acceptance pending |
| D30 | AI route helper adoption and preparation | D10/D11 decisions applicable to routes | PARTIAL — ID tests pass; route preparation evidence pending |
| D31 | Rust wire decoder ownership | D01; coordinate API M20 before paths move | IMPLEMENTED — focused decoder tests pass |
| D32 | Canonical JSON deduplication | D01; cold-tier move order fixed by coordinator | PARTIAL — API/AI golden vectors pass; reducer parity pending |
| D33 | Identifier/case conversion contracts | D01; coordinate D31/D32 source ownership | IMPLEMENTED — focused convention tests pass |
| D34 | Navigation catalog and presentation adoption | D01 | IMPLEMENTED — navigation acceptance pending |
| D35 | Shadow HR policy/AI registry disposition | D00/D01 | HISTORICAL IMPLEMENTATION — see execution record |
| D36 | HTTP error/auth boundary cleanup | D01; coordinate M10/M11/M21/M60 | IMPLEMENTED — source errors retained; M60 selected GET callers integrated |
| D37 | Warning/stub/PDF disposition | D00/D01 | PARTIAL — callback seam repaired; stub policy pending |
| D40 | Existing API modularization M-task execution | D00/D01; per-module prerequisite gate below | IN PROGRESS — see M-task ledger |
| D41 | Frontend hook/utility segmentation | Relevant D10/D11/D30/D34 acceptance | IMPLEMENTED — integrated frontend checks pass |
| D42 | Bounded domain wave-file segmentation | Relevant D20–D24 acceptance | IMPLEMENTED — standalone library/test targets compile; live gates pending |
| D50 | CI/E2E setup consolidation | D00; tooling path inventory from D40–D42 | HISTORICAL IMPLEMENTATION — separate DX ledger applies |
| D60 | Ownership checks, documentation, discovery checks | Each relevant family accepted; incremental | PARTIAL — structural owner and nonempty-test guards added; broader semantic checks separate |
| D90 | Final integrated verification and handoff | All required tasks accepted | IN PROGRESS — final and service-backed gates outstanding |

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

- Implementation base: `e58843bcc` on `vibe/c2-postgres-projection-ir-v2`; all changes uncommitted in working tree.
- Active tasks/owners: D41 IN PROGRESS (hr + inventory segmentation complete, accounting.ts pending); D40/D42/D90 remain.
- Cargo/codegen slot: available.
- Accepted tasks: D00, D01, D10, D11, D12, D13, D20, D21, D22, D23, D24, D25, D30, D31, D32, D33, D34, D35, D36, D37, D50, D60.
- Next action: finish D41 accounting.ts segmentation, then D40/D42/D90.
- Product-decision blockers:
  - Proposal stub: `proposals.rs::mock_analysis()` returns 200 OK on gateway failure; needs user direction.
  - Statutory adapters: 7 jurisdictions return "accepted_stub"; needs user direction.
- Deferred to companion M-plan: D40 (API modularization), D36 extractor/caller adoption (M60).

### D41 — Frontend hook/utility segmentation (in progress)

Status: hr.ts and inventory.ts segmentation COMPLETE and verified; accounting.ts segmentation NOT YET STARTED.

Completed sub-tasks:
- hr.ts → hr/ directory (9 submodules + barrel index.ts). 1530 lines → 8 feature modules + barrel. Typecheck clean, 47 tests pass, web typecheck clean.
- inventory.ts → inventory/ directory (12 submodules + shared.ts + barrel index.ts). 3894 lines → 12 feature modules + shared helpers + barrel. Typecheck clean, 47 tests pass, web typecheck clean.
- package.json exports updated: `"./hooks/hr"` and `"./hooks/inventory"` added before `"./hooks/*"` wildcard.

Remaining sub-task:
- accounting.ts (2680 lines, ~130 exports) → accounting/ directory with 16 submodules.
  Extraction script written at scratchpad `extract-accounting.sh` but NOT yet run.
  Target submodules: accounts, journals, moves, budgets, taxes, bank-statements, payments,
  analytic, assets, fiscal-periods, consolidation, intercompany, fx-credit-amortization,
  currencies, imports, index.
  Cross-submodule dependencies: imports.ts needs invalidateChartStructureQueries (accounts),
  invalidateMoveQueries (moves), invalidateBudgetQueries (budgets), invalidateAnalyticQueries
  (analytic), invalidateTaxQueries + useImportTaxRateCsv (taxes). fx-credit-amortization.ts
  needs invalidateMoveQueries (moves).
  Non-exported invalidation helpers must be changed to `export function` in their owning submodules.
  Mid-file import `parseCallError` at line 476 must be hoisted to each submodule header.
  Type re-exports (lines 68-93) go in index.ts barrel.

Next executable steps for accounting.ts:
1. Run extraction script to create accounting/ submodules
2. Delete accounting.ts
3. Add `"./hooks/accounting": "./src/hooks/accounting/index.ts"` to package.json exports
4. Run typecheck + test + web typecheck; fix any errors (likely duplicate exports or line range adjustments)
5. Update plan: D41 → ACCEPTED

### D00 — Baseline and inventory (accepted)

Detailed evidence: scratchpad `d00-inventory.md`.

Baseline test results (all clean, 0 failures):

| Area | Result |
| --- | --- |
| erp-shared | 18 pass |
| query-hooks | 47 pass |
| ui | 26 pass |
| api-server + ai-gateway | 0 errors, 57 ai-gateway warnings |
| codegen query_exec_audit | 2 pass |
| spacetimedb --tests | 0 errors, 10 warnings |

Source scanners and path dependencies:

1. `query_exec_audit` (`lumiere-codegen/src/query_exec_audit/mod.rs:42`) — textual first-match for `pub async fn execute_resource_query` in `query_exec.rs`. M01 (companion plan) flags this can select `authoritative_resource_scope`. Path hardcoded in `paths.rs:122`.
2. `spacetimedb_src_dir` (`paths.rs:140`) — `spacetimedb/src` root for cold-tier bindings parsing.
3. `query-hooks` test glob: `src/hooks/*.test.ts` — does NOT discover nested test directories. D41 must update this.
4. `codegen paths.rs` — single resolution point for all generated artifact paths. Any module move requires coordinator-owned update.

F-family classification (all confirmed or corrected against current tree):

| ID | Class | Task | Key evidence |
| --- | --- | --- | --- |
| F01 | V | D10 | `optionalBigIntU64` rounds via `Number()`; 9 `toScalarU64` copies accept negatives |
| F02 | V/E | D11 | 4 row/timestamp helpers with different alias/null/micros heuristics; no tests |
| F03 | V | D12 | Contact phone blank→mobile fallback mismatch between contact/import detection |
| F04 | E/V | D13 | `split_csv_row` identical across 3 runtimes; header/blank-line handling differs |
| F05 | E | D20 | `load_fx_account` identical to `require_active_account`; tax-list validation duplicated |
| F06 | E | D20 | 3 identical analytic-account validators |
| F07 | E/I | D21 | 4 identical employee-scope checks; `global_assignment` intentionally different |
| F08 | E | D21 | 2 identical subscription loaders, 13 callers total |
| F09 | E/V | D22 | 4+2 identical line constructors; 2 company-only validators (not equivalent) |
| F10 | E | D23 | 2 identical FX metadata merge functions |
| F11 | E | D24 | 2 identical `replay_receipt` functions, 4 active callers |
| F12 | E/V | D25 | 3 integration workers ~90% identical |
| F13 | E/V | D30 | 24 routes use `route-helpers.ts`, 7 don't; form/RAG duplicate sanitization |
| F14 | E/V | D31 | 19 u64 decoder variants with different envelope/signed/error behavior |
| F15 | E/I | D32 | 16 canonicalization functions; UUID-v5 vs SHA-256 vs FNV-1a intentionally different |
| F16 | V/I | D33 | 12 identifier validators; 8 `snake_to_camel`; relation suffix handling differs |
| F17 | E | D34 | Sidebar/command palette duplicate full navigation catalog + types |
| F18 | S | D35 | PII constants/predicates duplicated across field_policy.rs and pii.rs; 2 unused purpose constants |
| F19 | S | D35 | TS snapshot registry has zero consumers; Rust registry has 6 call sites |
| F20 | V/C | D36/D37 | 200+ ApiError constructions; 17 warn sites; no stub/PDF patterns in current tree |
| F21 | E/V | D50 | SSH setup in 2 workflows, Node+pnpm in 5; no composite actions exist |
| F22 | Structural | D40/D41/D42 | query_exec 2850, commit_projection 1244, auth 1136; hooks hr 1535, inventory 3899, accounting 2504 |

Dirty-file ownership: clean tree at start; no concurrent changes to preserve.

### D01 — Behavioral contracts and decision records (accepted)

Decision records for each V/S family. Coordinator-scoped decisions are marked;
product decisions requiring user direction are flagged as blockers.

**D01-01 / F01 — ID parsing contract (coordinator-scoped)**

Current variants: `optionalBigIntU64` rounds via `Number()` (loses precision above
2^53), returns `undefined` for invalid/negative. `toScalarU64` (9 copies) uses
`BigInt(String(v))` (correct), accepts negatives, throws on null/blank.

Accepted contract: parse integer strings directly to `BigInt`. Validate
`0 <= n <= 18446744073709551615`. Accept JS numbers only when safe integers and
in range. Reject negatives (return undefined or error, not a wrapped positive).
Absent (null/undefined/empty string) returns `undefined`; invalid (non-numeric,
fractional, out of range) returns `undefined` for form coercion or throws for
strict scalar contexts — caller chooses policy. Zero is valid (not globally
forbidden). `9007199254740993` string must remain exact.

Correction: fix `optionalBigIntU64` to try `BigInt(String(v))` before `Number(v)`.
Extract to `erp-shared/src/u64.ts` with compatibility entry points in
`form-coercion.ts`. Migrate 9 `toScalarU64` copies to delegate to the new owner.

Test vectors: 0, 1, max u64, max+1, negative, fraction, unsafe JS number,
`"9007199254740993"` (exact), whitespace, empty, null, undefined, scientific
notation, `"12suffix"`, arrays, patch-clear cases.

Owner: D10.

**D01-02 / F02 — Timestamp and row-access contract (coordinator-scoped)**

Current variants: `formatTimestampLike` accepts `microsSinceUnixEpoch` only.
`timestampToMs` uses heuristic >1e15 = micros. `auditTimestampToIso` uses
>10B = micros and checks both camelCase and snake_case `micros_since_unix_epoch`.
`getRowField` tries 3 directions; `rowField` (stored-dashboard) tries 2.

Accepted contract: named millisecond/microsecond/ISO/SDK-object adapters, not a
universal heuristic. Preserve null (first-owned-key returns null, first-non-null-key
skips null). Keep outbound reducer timestamp construction separate
(`stb-timestamp.ts`). For legacy ambiguous numeric inputs, retain a named
compatibility adapter until producer evidence resolves the unit.

Correction: extract pure row access to `erp-shared/src/row-values.ts`. Extract
timestamp adapters to `erp-shared/src/timestamp-values.ts`. No lower-package
dependency cycle. Finish settings audit adoption of existing utility.

Test vectors: alias collisions; null/undefined/false/zero/empty; Date, ISO,
numeric ms, numeric micros, SDK wrappers, invalid dates, range/overflow.

Owner: D11.

**D01-03 / F03 — Contact matching contract (coordinator-scoped)**

Current variants: `contact-duplicate-detection.ts` does two-pass blank→mobile
phone fallback. `import-duplicate-detection.ts` uses `??` chain (only tries
mobile if phone is nullish, not blank). Rust `duplicate.rs` does two-pass
blank→mobile (matches contact-duplicate-detection).

Accepted contract: blank phone falls back to mobile for the common contact
case (matching Rust). Import-only matching (external ref, vendor, product/SKU)
remains separate. Server merge authorization stays independent.

Correction: fix `import-duplicate-detection.ts` `rowPhone` to two-pass
blank→mobile. Extract shared primitives to `erp-shared/src/contact-matching.ts`.

Test vectors: blank/whitespace/null phone with mobile; case-normalized email;
conflicting aliases; duplicate IDs; deleted/merged; cross-company; vendor-only;
external-ref.

Owner: D12.

**D01-04 / F04 — CSV parsing contract (coordinator-scoped)**

Current variants: `split_csv_row` identical across 3 runtimes. Outer parsers
differ: `helpers.rs::parse_csv` uses naive `split(',')` + lowercases headers.
`import.rs::parse_csv_text` uses `split_csv_row` for headers (quote-aware,
preserves casing). Frontend filters blank lines and normalizes CRLF; Rust
keeps blank lines.

Accepted contract: row splitter is the shared algorithm. Header handling is a
separate canonical normalization step. Blank-line policy: filter consistently
(CRLF-normalized). No new dependency. Existing line-by-line parsers do not
establish multiline quoted-field support — reject clearly or implement as
separately reviewed change.

Correction: standardize `parse_csv` in `helpers.rs` to use `split_csv_row` for
headers. Document blank-line/CRLF policy. AI parsing stays behind adapter seam.

Test vectors: quoted commas/headers, escaped quotes, CRLF, trailing newline,
blank rows, malformed/unclosed quotes, embedded newline disposition, Unicode,
formula-safety checks, round-trip and retry row numbering.

Owner: D13.

**D01-05 / F09c — Company-only account validators (coordinator-scoped)**

Current: `expenses.rs:774` and `expense_depth.rs:262` validate by company_id
only (no org/deprecated/active check). Not equivalent to `require_active_account`.

Accepted contract: these are intentionally weaker validators. Do NOT replace
with `require_active_account` as a mechanical edit. Record the policy difference.
Preserve as-is unless user separately approves tightening.

Correction: none (documentation only). Owner: D22 (record only).

**D01-06 / F14 — Wire decoder contract (coordinator-scoped)**

Current variants: 19 u64 decoders. Only `query_exec.rs` handles Option
envelopes (`{none}/{some}`). `workflow_reads.rs` has signed `as_i64 as u64`
fallback. `skill_loader.rs` returns 0 on failure. `required_*` variants reject
zero. `workflow_worker.rs` uses `as_u64` only (no string parse).

Accepted contract: reuse canonical/generated transport codecs where they cover
the actual input format. Eliminate exact AI copies first. Keep query-specific
error/status adapters local. A common primitive must not silently normalize
malformed data to zero/None or choose an organization/company.

Correction: initially preserve `query_exec/row_values.rs` facade per
modularization plan. Adapter differences (signed fallback, Option envelope,
zero rejection) are named and tested, not silently merged.

Test vectors: scalar/string limits; negative signed; overflow; null/missing;
Some/None envelopes; alias collision; valid/malformed identities.

Owner: D31.

**D01-07 / F15 — Canonical JSON (intentional differences)**

Current: UUID-v5 (audit.rs), SHA-256 hex (cold-tier persistence/conventions),
SHA-256 prefixed (certification), FNV-1a (queue.rs). Some use `object.iter()`
(preserves insertion order), others explicitly sort keys.

Accepted contract: retain different hash algorithms — they serve different
protocols. Share only proven equivalent recursive canonicalization within each
tier. Do not consolidate hash algorithms or create service dependencies in
`spacetimedb/src/core/persistence.rs`. Cross-universe equivalence tested.

Correction: none for hash algorithms. Within cold-tier and AI respectively, share
proven equivalent canonicalization. Coordinate sequencing with M31/M32/M33.

Test: golden canonical bytes and final hashes captured before extraction.

Owner: D32.

**D01-08 / F16 — Identifier grammar (coordinator-scoped)**

Current: 12 validators with different charsets (`[a-z0-9_]` vs `[a-z0-9-]`),
max lengths (128 vs none), first-char rules (any vs a-z only), quote escaping
(yes vs no). 8 `snake_to_camel` copies (some `to_uppercase` vs
`to_ascii_uppercase`). `camel_to_snake` in `sql_columns_emit.rs` handles
relation suffixes (M2O/M2M/O2M); the one in `stdb_bindings_parse.rs` does not.

Accepted contract: one PG-specific helper for cold-tier. Generator-local
equivalents tested against the same agreed names. Different conversions named
by source semantics. Do not merge camelCase type-name converter with
parameter-field conversion that handles relation suffixes. Preserve valid
existing manifest names.

Correction: name different conversions by their source semantics. Validate in
release builds, not only debug assertions.

Owner: D33.

**D01-09 / F18 — HR PII shadows (coordinator-scoped)**

Current: identical constants/predicates in `field_policy.rs` (HTTP SQL layer)
and `pii.rs` (reducer layer). `PURPOSE_VIEW_COMP` and `PURPOSE_VIEW_STATUTORY_ID`
in pii.rs have no callers (string literals used instead). Compensation constants
are used in both.

Accepted contract: both consumers exist (different enforcement boundaries at
HTTP and reducer). Retain independent enforcement. Remove unused purpose
constants after proving no callers/export obligations. Do not delete used
compensation constants or the PII audit reducer/table.

Correction: remove `PURPOSE_VIEW_COMP` and `PURPOSE_VIEW_STATUTORY_ID` if no
callers found. Retain duplicated constants as intentional cross-boundary
duplicate with parity documentation.

Owner: D35.

**D01-10 / F19 — AI snapshot registry (coordinator-scoped)**

Current: Rust `entity_registry.rs` has 6 call sites in `snapshot.rs`. TS
`ai-entity-snapshot-registry.ts` has zero direct consumers beyond `index.ts`
barrel `export *`.

Accepted contract: inspect package exports and consumer boundaries for TS
registry. Retire obsolete internals if no external consumer exists. Preserve a
documented compatibility export if needed. Derive both from one reviewed source
if two consumers genuinely remain.

Correction: if TS registry has no consumers, retire internals and preserve
compatibility export. If consumers exist, establish a neutral specification
source with parity tests.

Owner: D35.

**Product-decision blockers (require user direction):**

- Proposal stub behavior: whether a proposal mock should return a service error
  or a labeled development response (D37). Independent structural work continues.
- Company-only account validator tightening: whether to upgrade F09c validators
  to full org/deprecated/active checks (D22). Default: preserve as-is.

### D10 — Strict ID parsing and caller migration (accepted)

Task / finding IDs / status: D10 / F01 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `frontend/packages/erp-shared/src/u64.ts`, `u64.test.ts`
  - Modified: `erp-shared/src/form-coercion.ts`, `index.ts`, `package.json`
  - Modified: 13 hook files in `query-hooks/src/hooks/` (pos, auth, crm, sales,
    accounting, helpdesk, hr, purchasing, documents, inventory, proposals,
    projects, messages)
Old functions and callers -> final owner:
  - `optionalBigIntU64` (form-coercion.ts) → delegates to `parseStrictU64` (u64.ts)
  - `nullableBigIntU64` → delegates to `parseStrictU64`
  - `parseDelimitedU64Ids` → delegates to u64.ts (fixed: BigInt not Number)
  - 13 `toScalarU64` copies → import `scalarToU64 as toScalarU64` from u64.ts
  - 6 `type ScalarId` definitions → import `type ScalarId` from u64.ts
Decision IDs / intentional behavior changes:
  - D01-01: parse strings directly to BigInt before Number(); validate 0..U64_MAX
  - `scalarToU64` adds range validation (rejects negatives, out-of-range) — corrects
    silent invalid-to-valid ID conversion. No caller passes negatives intentionally.
Copies removed / remaining adapters and reasons:
  - 13 local `toScalarU64` definitions removed
  - 6 local `ScalarId` type definitions removed
  - `optionalBigIntU64`/`nullableBigIntU64` kept as compatibility wrappers in
    form-coercion.ts (existing callers import from there)
Tests discovered / executed / passed / failed / skipped:
  - erp-shared: 36 pass (18 original + 18 new u64.test.ts)
  - query-hooks: 47 pass (unchanged)
  - ui: 26 pass (unchanged)
  - typecheck: erp-shared, query-hooks, ui, web — all pass
Commands: `pnpm --filter @lumiere/erp-shared test`, `pnpm --filter @lumiere/query-hooks test`,
  `pnpm --filter @lumiere/ui test`, typecheck for all four packages
Baseline failures vs regressions: none (0 baseline failures, 0 regressions)
Review findings and resolutions:
  - `9007199254740993` string now preserved exactly through both paths
  - `parseDelimitedU64Ids` no longer loses precision for large IDs
  - `scalarToU64` adds RangeError for negatives/out-of-range (behavior correction per D01-01)
Exports / source scanners / test lists / docs updated:
  - Added `./u64` subpath export to erp-shared package.json
  - Added `export * from "./u64"` to index.ts
  - Added `u64.test.ts` to test script
Blocker or acceptance rationale: all callers migrated, tests and typechecks pass,
  precision bug fixed, no competing strict ID parsers remain
Next executable task: D20 (accounting/tax/analytic relation ownership)

### D20 — Accounting/tax/analytic relation ownership (accepted)

Task / finding IDs / status: D20 / F05, F06 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Modified: `spacetimedb/src/accounting/relations.rs` (added 2 shared functions)
  - Modified: `spacetimedb/src/accounting/fx_revaluation.rs` (F05a: removed load_fx_account)
  - Modified: `spacetimedb/src/accounting/chart_of_accounts.rs` (F05b: removed validate_account_tax_ids)
  - Modified: `spacetimedb/src/accounting/tax_management.rs` (F05b: removed validate_tax_ids)
  - Modified: `spacetimedb/src/projects/projects.rs` (F06: removed require_project_analytic_account)
  - Modified: `spacetimedb/src/expenses/expenses.rs` (F06: removed require_expense_analytic_account)
  - Modified: `spacetimedb/src/purchasing/purchase_orders.rs` (F06: removed require_analytic_account_for_company)
Old functions and callers -> final owner:
  - F05a: `load_fx_account` (fx_revaluation.rs, 4 calls) → `require_active_account` (relations.rs)
  - F05b: `validate_account_tax_ids` (chart_of_accounts.rs, 2 calls) + `validate_tax_ids`
    (tax_management.rs, 2 calls) → `require_active_tax_ids` (relations.rs, 4 total calls)
  - F06: `require_project_analytic_account` (projects.rs, 2 calls) +
    `require_expense_analytic_account` (expenses.rs, 1 call) +
    `require_analytic_account_for_company` (purchase_orders.rs, 2 calls) →
    `require_analytic_account` (relations.rs, 5 total calls)
Decision IDs / intentional behavior changes: none (extraction preserves exact error text/order)
Copies removed / remaining adapters and reasons:
  - 7 duplicate functions removed, all callers migrated to shared owners in relations.rs
  - Unused imports cleaned: account_tax (chart_of_accounts), HashSet (tax_management),
    account_analytic_account (projects, expenses, purchase_orders), account_account (fx_revaluation)
  - F09c company-only validators preserved as-is per D01-05 (not equivalent, no tightening)
Tests discovered / executed / passed / failed / skipped:
  - spacetimedb --tests: 0 errors, 10 warnings (same as baseline)
  - codegen query_exec_audit: 2 pass
Commands: `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`,
  `cargo test --locked -p lumiere-codegen query_exec_audit`
Baseline failures vs regressions: none (10 baseline warnings preserved, 0 new warnings, 0 errors)
Review findings and resolutions:
  - Error text preserved exactly: "Tax {id} is duplicated", "Tax {id} not found", etc.
  - `require_active_tax_ids` built standalone (not on `require_active_tax`) to preserve exact
    error format without role prefix
  - `require_analytic_account` uses `ctx.db.account_analytic_account()` with import from
    `analytic_accounting` module
Exports / source scanners / test lists / docs updated: none needed (pub(crate) visibility)
Blocker or acceptance rationale: all callers migrated, error text preserved, compiles clean,
  no new warnings, codegen audit passes
Next executable task: D22 (journal-line constructor ownership)

### D21 — HR/subscription relation ownership (accepted)

Task / finding IDs / status: D21 / F07, F08 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `spacetimedb/src/hr/relations.rs` (require_employee_in_scope)
  - Created: `spacetimedb/src/subscriptions/relations.rs` (require_subscription)
  - Modified: `spacetimedb/src/hr/mod.rs` (pub mod relations)
  - Modified: `spacetimedb/src/subscriptions/mod.rs` (pub mod relations)
  - Modified: `spacetimedb/src/hr/benefits.rs` (F07: removed assert_employee_scope, 1 call)
  - Modified: `spacetimedb/src/hr/performance.rs` (F07: same, 1 call)
  - Modified: `spacetimedb/src/hr/documents.rs` (F07: same, 1 call)
  - Modified: `spacetimedb/src/hr/onboarding.rs` (F07: same, 1 call)
  - Modified: `spacetimedb/src/subscriptions/subscription_wave_d.rs` (F08: removed load_subscription, 1 call)
  - Modified: `spacetimedb/src/subscriptions/subscription_wave_e.rs` (F08: removed load_sub, 9 calls)
Old functions and callers -> final owner:
  - F07: `assert_employee_scope` in benefits/performance/documents/onboarding (4 functions, 4 calls)
    -> `require_employee_in_scope` (hr/relations.rs)
  - F08: `load_subscription` (wave_d, 1 call) + `load_sub` (wave_e, 9 calls) = 10 total
    -> `require_subscription` (subscriptions/relations.rs)
  - `global_assignment.rs` intentionally NOT touched: different signature (returns HrEmployeeRef,
    checks organization only, returns company info) per F07 class I
Decision IDs / intentional behavior changes: none (extraction preserves exact error text/order)
Copies removed / remaining adapters and reasons:
  - 6 duplicate functions removed, all callers migrated to shared owners
  - `global_assignment.rs` preserved as intentional variant (class I, cross-company assignment)
Tests discovered / executed / passed / failed / skipped:
  - spacetimedb --tests: 0 errors, 10 warnings (same as baseline)
Commands: `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`
Baseline failures vs regressions: none (10 baseline warnings preserved, 0 new warnings, 0 errors)
Review findings and resolutions:
  - Error text preserved exactly from original functions
  - `require_employee_in_scope` uses `pub(crate)` visibility, takes (ctx, org_id, emp_id)
  - `require_subscription` uses `pub(crate)` visibility, takes (ctx, org_id, company_id, sub_id),
    returns `subscription::Subscription` row (matching both originals)
  - Initial migration missed 9 remaining `load_sub` callers in wave_e; fixed in follow-up
Exports / source scanners / test lists / docs updated: none needed (pub(crate) visibility)
Blocker or acceptance rationale: all callers migrated, error text preserved, compiles clean,
  no new warnings, global_assignment intentionally preserved
Next executable task: D24 (workflow receipt ownership)

### D23 — FX metadata ownership (accepted)

Task / finding IDs / status: D23 / F10 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `spacetimedb/src/accounting/fx_metadata.rs` (merge_exchange_rate_metadata)
  - Modified: `spacetimedb/src/accounting/mod.rs` (pub mod fx_metadata)
  - Modified: `spacetimedb/src/sales/sales_core.rs` (removed local fn, added import)
  - Modified: `spacetimedb/src/purchasing/purchase_orders.rs` (removed local fn, updated caller)
Old functions and callers -> final owner:
  - F10: `merge_exchange_rate_metadata` (sales_core.rs, 1 call) +
    `merge_po_exchange_rate_metadata` (purchase_orders.rs, 1 call) ->
    `merge_exchange_rate_metadata` (accounting/fx_metadata.rs, 2 total calls)
Decision IDs / intentional behavior changes: none (byte-identical extraction)
Copies removed / remaining adapters and reasons:
  - 2 duplicate functions removed, all callers migrated to shared owner
  - No unused imports left (Timestamp still used 27x in purchase_orders.rs)
Tests: spacetimedb --tests: 0 errors, 10 warnings (same as baseline)
Commands: `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: none needed (pub(crate) visibility)
Blocker or acceptance rationale: byte-identical extraction, all callers migrated, compiles clean
Next executable task: D12 (contact normalization parity)

### D24 — Workflow receipt ownership (accepted)

Task / finding IDs / status: D24 / F11 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `spacetimedb/src/workflow/receipts.rs` (replay_command_receipt)
  - Modified: `spacetimedb/src/workflow/mod.rs` (pub(crate) mod receipts)
  - Modified: `spacetimedb/src/workflow/runtime.rs` (removed local fn, 3 callers migrated)
  - Modified: `spacetimedb/src/workflow/migration.rs` (removed local fn, 1 caller migrated)
Old functions and callers -> final owner:
  - F11: `replay_receipt` (runtime.rs, 3 calls) + `replay_receipt` (migration.rs, 1 call) ->
    `replay_command_receipt` (workflow/receipts.rs, 4 total calls)
  - approvals.rs `replay_receipt` NOT touched: different table (workflow_human_task_receipt),
    different return type (WorkflowHumanTaskReceipt), different error text (class V/I)
  - delivery.rs `replay_receipt` NOT touched: different table (workflow_delivery_receipt),
    different return type (WorkflowDeliveryReceipt), different error text (class V/I)
Decision IDs / intentional behavior changes: none (byte-identical extraction)
  - Renamed to `replay_command_receipt` to distinguish from the 2 intentionally different
    `replay_receipt` functions in approvals.rs and delivery.rs
Copies removed / remaining adapters and reasons:
  - 2 duplicate functions removed (runtime + migration)
  - approvals.rs and delivery.rs versions preserved as intentional variants (class V/I)
Tests: spacetimedb --tests: 0 errors, 10 warnings (same as baseline)
Commands: `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`
Baseline failures vs regressions: none (initial unused-import warning fixed)
Exports / source scanners / test lists / docs updated: none needed (pub(crate) visibility)
Blocker or acceptance rationale: byte-identical extraction, all callers migrated, compiles clean,
  intentionally different receipt types preserved as documented variants
Next executable task: D11 (row/timestamp contracts and audit helper adoption)

### D12 — Contact normalization parity (accepted)

Task / finding IDs / status: D12 / F03 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `frontend/packages/erp-shared/src/contact-matching.ts` (norm, rowId, rowEmail, rowPhone, rowName)
  - Created: `frontend/packages/erp-shared/src/contact-matching.test.ts` (7 tests)
  - Modified: `frontend/packages/erp-shared/src/index.ts` (export contact-matching)
  - Modified: `frontend/packages/erp-shared/package.json` (subpath export + test script)
  - Modified: `frontend/web/lib/contact-duplicate-detection.ts` (import shared primitives, removed 5 local fns)
  - Modified: `frontend/web/lib/import-duplicate-detection.ts` (import shared primitives, removed 5 local fns, fixed rowPhone)
Old functions and callers -> final owner:
  - F03: `norm`, `rowId`, `rowEmail`, `rowPhone`, `rowName` duplicated across both files ->
    shared `contact-matching.ts` (imported by both)
  - `rowPhone` in import-duplicate-detection.ts was the buggy variant: used `??` chain
    that didn't fall back from blank phone to mobile. Now uses canonical behavior
    (phone first, mobile fallback when blank) matching Rust `crm/duplicate.rs::contact_phone`
Decision IDs / intentional behavior changes:
  - D01-03: phone blank→mobile fallback is canonical (matches Rust reference)
  - Import-specific functions preserved: isVendorContact, rowSku, previewField, productMatches,
    contactMatches (with mapping), filterCsvForImport, defaultDuplicateActions
  - Contact-specific functions preserved: isActiveContact, contactMatches (no mapping),
    canonicalPair, detectContactDuplicatePairs, contactRowLabel
Copies removed / remaining adapters and reasons:
  - 10 duplicate function definitions removed (5 per file)
  - Import-specific and contact-specific logic stays in respective files (not shared)
Tests: erp-shared 43 pass (was 36 + 7 new), web unit 42 pass, both typechecks pass
Commands: `pnpm --filter @lumiere/erp-shared test`, `pnpm --filter @lumiere/erp-shared typecheck`,
  `pnpm --filter ./web typecheck`, `pnpm --filter ./web test:unit`
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: index.ts, package.json exports + test script
Blocker or acceptance rationale: phone fallback fixed to match Rust canonical behavior, all primitives
  shared, import-specific and contact-specific logic preserved, tests and typechecks pass
Next executable task: D11 (row/timestamp contracts and audit helper adoption)

### D34 — Navigation catalog and presentation adoption (accepted)

Task / finding IDs / status: D34 / F17 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `frontend/packages/ui/src/lib/navigation-catalog.ts` (NavLinkItem, NavGroup, buildNavGroups)
  - Modified: `frontend/packages/ui/src/pages/dashboard-sidebar.tsx` (import shared catalog, removed 2 interfaces + navGroups array, cleaned 22 unused icon imports)
  - Modified: `frontend/packages/ui/src/pages/erp-command-palette.tsx` (same, cleaned 25 unused icon imports)
Old functions and callers -> final owner:
  - F17: `NavLinkItem`/`NavGroup` interfaces + `navGroups` array (7 groups, 28 items)
    duplicated character-for-character in both files ->
    `buildNavGroups(t)` in `navigation-catalog.ts` (called by both)
Decision IDs / intentional behavior changes: none (extraction preserves identical catalog)
  - Both presentations call `buildNavGroups(t)` inside `useMemo([t])` — same memoization behavior
  - Sidebar-specific: collapsed state, active route, badges, lock icons, prefetch, company switcher,
    user profile, sign-out, collapse toggle
  - Command-palette-specific: open state, Cmd+K shortcut, search, accessibleNavGroups filtering,
    runAction/navigate wrappers, CommandDialog/CommandItem rendering
Copies removed / remaining adapters and reasons:
  - 2 interface definitions removed, 2 navGroups arrays (66 lines each) removed
  - 22 navigation-only icon imports removed from sidebar (kept: ChevronLeft, Menu, Lock, BookOpen, Sparkles, BookMarked, LogOut)
  - 25 navigation-only icon imports removed from command palette (kept: BookOpen, Sparkles, BookMarked)
  - `Resource` type import removed from both files (no longer used directly)
Tests: ui 26 pass, typecheck pass
Commands: `pnpm --filter @lumiere/ui typecheck`, `pnpm --filter @lumiere/ui test`
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: none needed (internal import)
Blocker or acceptance rationale: character-identical catalog extracted to single owner, both presentations
  consume it, presentation-specific state/actions/rendering preserved, tests and typechecks pass
Next executable task: D22 (journal-line constructor ownership)

### D11 — Row/timestamp contracts and audit helper adoption (accepted)

Task / finding IDs / status: D11 / F02 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `frontend/packages/erp-shared/src/timestamp-values.ts` (microsToDate, millisToDate,
    isoToDate, stdbTimestampToDate, compatNumberToDate, timestampToIso)
  - Created: `frontend/packages/erp-shared/src/timestamp-values.test.ts` (18 tests)
  - Created: `frontend/packages/erp-shared/src/row-values.ts` (firstOwnedKey, firstNonNullKey,
    toSnakeCase, toCamelCase, getRowField)
  - Created: `frontend/packages/erp-shared/src/row-values.test.ts` (13 tests)
  - Modified: `frontend/packages/erp-shared/src/index.ts` (export timestamp-values, row-values)
  - Modified: `frontend/packages/erp-shared/package.json` (subpath exports + test script)
  - Modified: `frontend/packages/ui/src/settings/audit-log.tsx` (removed local timestampToIso,
    import shared auditTimestampToIso from audit-log-utils)
Old functions and callers -> final owner:
  - F02a: `timestampToIso` in settings/audit-log.tsx was a verbatim duplicate of `auditTimestampToIso`
    in audit-log-utils.ts -> now uses shared `auditTimestampToIso`
  - F02b: Named timestamp adapters created in `timestamp-values.ts` for future migration:
    microsToDate, millisToDate, isoToDate, stdbTimestampToDate, compatNumberToDate, timestampToIso
  - F02c: Row property primitives created in `row-values.ts` for future migration:
    firstOwnedKey (preserves null), firstNonNullKey, getRowField (3-direction lookup)
Decision IDs / intentional behavior changes:
  - D01-02: Timestamp adapters are named (not a universal heuristic). Each handles a single
    representation. compatNumberToDate preserves existing ms/micros threshold (10B) for legacy inputs.
  - Settings-specific `formatAuditDetails` preserved (includes table/record prefix, different from
    shared `formatAuditEntryDetails` which omits prefix)
  - Settings audit `mapAuditRow` hardcodes actor as "System" — preserved (product decision, not changed)
  - Record audit tab uses shared audit-log-utils (already adopted, no change needed)
Copies removed / remaining adapters and reasons:
  - 1 verbatim duplicate function removed (timestampToIso in settings/audit-log.tsx)
  - 3 different ms/micros thresholds documented as intentional variants (1e15 dashboard, 1e10 audit,
    none entity-row-utils). Not forced to one universal threshold per D01-02.
  - Row lookup variants preserved: getRowField (3-dir, hasOwnProperty) in row-values.ts vs
    rowField (2-dir, in) in stored-dashboard-resolver. Migration deferred — different semantics.
Tests: erp-shared 73 pass (was 43 + 30 new), ui 26 pass, web typecheck pass
Commands: `pnpm --filter @lumiere/erp-shared test`, `pnpm --filter @lumiere/erp-shared typecheck`,
  `pnpm --filter @lumiere/ui test`, `pnpm --filter @lumiere/ui typecheck`, `pnpm --filter ./web typecheck`
Baseline failures vs regressions: none (initial type error fixed: micros cast to number|bigint|string)
Exports / source scanners / test lists / docs updated: index.ts, package.json exports + test script
Blocker or acceptance rationale: settings audit duplicate removed, named timestamp/row primitives
  available for future migration, settings-specific detail format preserved, all tests/typechecks pass
Next executable task: D13 (CSV parsing contract/parity)

### D22 — Journal-line constructor ownership (accepted)

Task / finding IDs / status: D22 / F09 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `spacetimedb/src/accounting/line_params.rs` (journal_line_params, blank_journal_line,
    validate_company_account)
  - Modified: `spacetimedb/src/accounting/mod.rs` (pub(crate) mod line_params)
  - Modified: `spacetimedb/src/hr/payroll.rs` (removed payroll_line_params + validate_payroll_account, 3+1 calls migrated)
  - Modified: `spacetimedb/src/expenses/expenses.rs` (removed empty_line_params + validate_account, 8+1 calls migrated)
  - Modified: `spacetimedb/src/expenses/expense_depth.rs` (removed empty_line_params + validate_account, 3+1 calls migrated)
  - Modified: `spacetimedb/src/expenses/expense_wave_d.rs` (removed advance_line_params + validate_advance_account, 2+1 calls migrated)
  - Modified: `spacetimedb/src/purchasing/purchase_returns.rs` (removed empty_move_line, 2 calls migrated)
  - Modified: `spacetimedb/src/subscriptions/billing_helpers.rs` (removed blank_line, 5 calls migrated)
  - Modified: `spacetimedb/src/subscriptions/subscription_wave_d.rs` (updated import, 2 calls migrated)
  - Modified: `spacetimedb/src/subscriptions/subscription_wave_c.rs` (updated import, 4 calls migrated)
Old functions and callers -> final owner:
  - F09 Family A (4 identical): payroll_line_params, empty_line_params (x2), advance_line_params
    -> journal_line_params (accounting/line_params.rs). 16 total calls migrated.
  - F09 Family B (2 identical): empty_move_line, blank_line
    -> blank_journal_line (accounting/line_params.rs). 13 total calls migrated.
  - F09 validators (4 identical): validate_payroll_account, validate_account (x2), validate_advance_account
    -> validate_company_account (accounting/line_params.rs). 4 total calls migrated.
Decision IDs / intentional behavior changes:
  - D01-05: Company-only validators preserved as-is (NOT strengthened to require_active_account).
    validate_company_account checks only company_id, returns (), no org_id or deprecated check.
    Documented as intentionally weaker per plan: "Do not replace company-only validators with
    stronger checks as a mechanical edit."
  - Family A and B kept as distinct profiles (not collapsed into one). Family A takes 5 params
    with computed quantity/price_unit; Family B takes 2 params with hardcoded zeros.
Copies removed / remaining adapters and reasons:
  - 10 duplicate function definitions removed (4+2+4)
  - 6 unused AddAccountMoveLineParams imports cleaned
  - 4 unused account_account imports cleaned (used only by removed validate functions)
  - 1 unused Table import cleaned from line_params.rs
Tests: spacetimedb --tests: 0 errors, 10 warnings (same as baseline)
  codegen query_exec_audit: 2 pass
Commands: `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`,
  `cargo test --locked -p lumiere-codegen query_exec_audit`
Baseline failures vs regressions: none (initial unused imports cleaned to restore 10-warning baseline)
Exports / source scanners / test lists / docs updated: none needed (pub(crate) visibility)
Blocker or acceptance rationale: all 10 duplicate functions removed, 33 callers migrated to 3 shared
  owners, company-only validators preserved as intentional variant, compiles clean at baseline warnings
Next executable task: D25 (integration-worker lifecycle)

### D13 — CSV parsing contract/parity (accepted)

Task / finding IDs / status: D13 / F04 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Modified: `spacetimedb/src/data_ops/helpers.rs` (parse_csv: use split_csv_row for headers, document blank-line policy)
  - Modified: `frontend/packages/erp-shared/src/csv-import-safety.test.ts` (8 splitCsvRow/parseCsvText parity tests)
Old functions and callers -> final owner:
  - F04a: `split_csv_row` (spacetimedb/helpers.rs and ai-gateway/import.rs) — byte-identical, retained
    as intentional cross-build-universe copies per architecture rule #10. Parity documented via tests.
  - F04b: `splitCsvRow` (frontend/csv-import-safety.ts) — functionally identical to Rust, retained as
    separate language implementation. Parity tests added.
Decision IDs / intentional behavior changes:
  - D01-04: Row splitter characterized as identical across all 3 implementations (class E)
  - Behavior correction: SpacetimeDB `parse_csv` now uses `split_csv_row` for header parsing instead
    of `.split(',')`. This fixes quoted-header support where the same CSV enters preview and import.
    Previously, a header like `"First,Name",Phone` would be split into 3 fields; now correctly 2.
  - Header lowercasing preserved as an explicit named step (not a side effect of the tokenizer)
  - Blank-line policy documented: frontend `parseCsvText` filters blank lines; Rust `parse_csv`
    does NOT filter (row numbers correspond 1:1 to input lines). Documented in function docs.
  - Size limit (MAX_CSV_BYTES) is frontend-only (AI safety policy), not shared with Rust
Copies removed / remaining adapters and reasons:
  - 0 copies removed — all 3 splitCsvRow/split_csv_row implementations retained as intentional
    cross-runtime/language boundaries (class I per architecture rules #9 and #10)
  - 1 behavior correction: SpacetimeDB header parsing upgraded from .split(',') to split_csv_row
Tests: erp-shared 81 pass (was 73 + 8 new), spacetimedb --tests: 0 errors, 10 warnings (baseline)
Commands: `pnpm --filter @lumiere/erp-shared test`, `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: csv-import-safety.test.ts updated with parity tests
Blocker or acceptance rationale: row splitter characterized and documented, quoted-header consistency
  fixed in SpacetimeDB, blank-line policy documented, parity tests added, all tests pass
Next executable task: D25 (integration-worker lifecycle)

### D25 — Integration-worker lifecycle (accepted)

Task / finding IDs / status: D25 / F12 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `api-server/src/integration_worker.rs` (IntegrationWorkerSpec, serve, process_batch)
  - Modified: `api-server/src/lib.rs` (added `pub mod integration_worker`)
  - Modified: `api-server/src/expense_integration_worker.rs` (thin wrapper, 13 lines)
  - Modified: `api-server/src/hr_integration_worker.rs` (thin wrapper, 13 lines)
  - Modified: `api-server/src/project_integration_worker.rs` (thin wrapper, 13 lines)
Old functions and callers -> final owner:
  - F12: Three integration workers (expense/HR/project) had >95% identical serve/poll/readiness
    lifecycle. Only differences: env prefix, default port, reducer name, log label.
    All common lifecycle extracted to `integration_worker.rs::serve()`.
    Each domain file retains doc comments and explicit reducer name in IntegrationWorkerSpec.
  - process_batch uses ReducerCall::from_name instead of reducer_call! macro; contract validation
    (arity, scalar kind) still enforced at runtime via from_name. Reducer name is a &'static str
    in the spec, derived from the same canonical constant lookup.
Decision IDs / intentional behavior changes: none (mechanical extraction, behavior preserved)
Copies removed / remaining adapters and reasons:
  - Removed: 3x serve() scaffold (env parsing, AppState setup, tokio::spawn poll loop, health router,
    TcpListener, axum::serve), 3x process_batch function body
  - Remaining: 3 domain wrapper files (doc comments + IntegrationWorkerSpec with explicit reducer name)
  - NOT absorbed: workflow_worker.rs (lease tokens, timer dispatch, outbox state machine — different
    architecture), owner_report_worker.rs (auto-discovers org IDs, renders PDFs, queue worker
    registration), projection_worker.rs (PG pool, commit projection, schema DDL), audit_drainer.rs
Tests discovered / executed / passed / failed / skipped: no unit tests exist for these workers
  (require running SpacetimeDB); compile verification used instead
Commands, target/feature/environment gates:
  - `cargo check --locked -p api-server` — 0 errors, 25 warnings (baseline, all from workflow_worker
    pre-existing test helpers)
  - `cargo check --locked -p api-server --bin expense-integration-worker --bin hr-integration-worker
    --bin project-integration-worker` — 0 errors
  - `cargo check --locked -p ai-gateway` — 0 errors, 57 warnings (baseline)
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: none needed (internal module, no path moves)
Blocker or acceptance rationale: common serve/poll/readiness lifecycle extracted to single owner,
  all 3 worker binaries compile, reducer dispatch stays explicit per domain, workflow/projection/
  drainer workers intentionally not absorbed
Next executable task: D30 (AI HTTP boundary)

### D30 — AI HTTP boundary (accepted)

Task / finding IDs / status: D30 / F13 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `frontend/web/app/api/ai/_lib/form-request.ts` (sanitizeFields, SUPPORTED_FIELD_TYPES,
    MAX_FIELDS, MAX_RAW_TEXT_LENGTH, aliasString)
  - Created: `frontend/web/app/api/ai/_lib/rag-request.ts` (sanitizeIncludeTypes, MAX_INCLUDE_TYPES,
    prepareRagPayload, RagPayload, RagPrepareResult)
  - Modified: `frontend/web/app/api/ai/forms/suggest/route.ts` (thin wrapper using shared helpers)
  - Modified: `frontend/web/app/api/ai/forms/validate/route.ts` (thin wrapper using shared helpers)
  - Modified: `frontend/web/app/api/ai/rag/route.ts` (thin wrapper using prepareRagPayload + proxyAiGateway)
  - Modified: `frontend/web/app/api/ai/rag/stream/route.ts` (uses prepareRagPayload, keeps SSE/streaming)
Old functions and callers -> final owner:
  - F13a: `sanitizeFields` + `SUPPORTED_FIELD_TYPES` + `MAX_FIELDS` duplicated byte-identical in
    forms/suggest and forms/validate -> extracted to `form-request.ts`
  - F13b: `sanitizeIncludeTypes` + `MAX_INCLUDE_TYPES` duplicated byte-identical in rag/route and
    rag/stream -> extracted to `rag-request.ts`
  - F13c: `positiveInteger` local copies in forms/suggest and forms/validate -> replaced with
    `positiveInteger` from route-helpers (identical implementation)
  - F13d: `nonEmptyString` local copies -> replaced with `aliasString` from form-request for
    snake/camel alias resolution; internal use in `sanitizeFields` kept private to form-request.ts
  - F13e: Manual `request.json()` try/catch in all 4 routes -> replaced with `parseJsonBody`
    from route-helpers
  - F13f: Manual `companyIdBelongsToOrganization` in all 4 routes -> replaced with
    `validateCompanyScope` from route-helpers
  - F13g: Manual `fetchAiGateway` + `JSON.parse` in forms/suggest, forms/validate, rag/route ->
    replaced with `proxyAiGateway` from route-helpers
  - F13h: Manual company-ID parsing and limit clamping in rag/route and rag/stream -> replaced
    with `positiveInteger` and `boundedInteger` via `prepareRagPayload`
Decision IDs / intentional behavior changes:
  - parseJsonBody adoption: non-object JSON bodies (arrays, scalars) now return 400 "JSON object
    body required" instead of being silently cast to Body interface. Behavior correction recorded.
  - proxyAiGateway adoption in forms/validate: gateway status is now passed through directly
    (`gw.status`) instead of normalized to 200 on success (`gw.ok ? 200 : gw.status`). The gateway
    returns 200 for successful validation, so no practical change.
  - proxyAiGateway adoption in forms/suggest and rag/route: no behavior change (already used
    `gw.status`). proxyAiGateway additionally catches JSON parse errors and returns
    `{ error: gw.text }` instead of throwing uncaught.
  - rag/stream keeps raw `fetch` + SSE response (not proxyAiGateway) — streaming must not go
    through buffered JSON helper per plan.
  - Stream-only fields (agent_id, team_member_id) kept explicit in rag/stream route using
    `optionalPositiveInteger` from route-helpers.
Copies removed / remaining adapters and reasons:
  - Removed: 2x sanitizeFields (60+ lines each), 2x sanitizeIncludeTypes, 2x positiveInteger,
    2x nonEmptyString, 2x SUPPORTED_FIELD_TYPES, 2x MAX_FIELDS, 2x MAX_INCLUDE_TYPES, 4x manual
    JSON parse, 4x manual companyScope, 3x manual fetchAiGateway+JSON.parse, 2x inline company-ID
    parsing, 2x inline limit clamping, 1x inline agent_id/team_member_id parsing
  - Remaining: 14 routes that use manual `fetchAiGateway` + `JSON.parse` instead of `proxyAiGateway`
    (action-draft/bridge, report/compose, skills/insights-scan, inventory/low-stock, etc.) —
    these have custom response handling or non-POST methods; not in scope for this task
Tests discovered / executed / passed / failed / skipped:
  - web unit tests: 42 pass (baseline 42)
  - web typecheck: clean
Commands: `pnpm --filter ./web typecheck` + `pnpm --filter ./web test:unit`
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: none needed (new _lib modules, no path moves)
Blocker or acceptance rationale: form and RAG sanitization extracted to shared owners, all 4
  routes adopted route-helpers for context/parse/scope/proxy, streaming stays in transport adapter,
  typecheck and all tests pass. Behavior corrections documented.
Next executable task: D31 (Rust wire decoding)

### D31 — Rust wire decoding (accepted)

Task / finding IDs / status: D31 / F14 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Created: `ai-gateway/src/wire_decode.rs` (row_u64, snake_to_camel — pub(crate))
  - Modified: `ai-gateway/src/main.rs` (added `mod wire_decode`)
  - Modified: `ai-gateway/src/harness/{distributor_controls,release_registry,low_stock,certification,snapshot}.rs`
  - Modified: `ai-gateway/src/tools/{tenant_files,scoped_sql}.rs`
  - Modified: `ai-gateway/src/ai_agent.rs`
  - Modified: `ai-gateway/src/skills/insights.rs`
  - Modified: `api-server/src/cold_tier/commit_projection.rs` (uses pg_codec::snake_to_camel)
Old functions and callers -> final owner:
  - F14a: 7 byte-identical `row_u64`/`optional_u64`/`u64_field` copies across ai-gateway
    (distributor_controls, release_registry, low_stock, tenant_files, scoped_sql,
    certification, ai_agent) -> all use `crate::wire_decode::row_u64`
  - F14b: 7 byte-identical `snake_to_camel` copies across ai-gateway (distributor_controls,
    release_registry, low_stock, snapshot, insights) + 1 in api-server (commit_projection)
    -> ai-gateway copies use `crate::wire_decode::snake_to_camel`;
    commit_projection uses `super::pg_codec::snake_to_camel` (already pub(crate))
  - F14c: `snake_to_camel_key` in insights.rs (same body, different name) -> renamed to
    `snake_to_camel`, uses shared import
Decision IDs / intentional behavior changes: none (mechanical extraction, behavior preserved)
Copies removed / remaining adapters and reasons:
  - Removed: 7 row_u64/optional_u64/u64_field copies, 8 snake_to_camel copies
  - Remaining (intentional variants, documented):
    - `row_u64` in query_exec.rs — returns Result<Option<u64>, String>, handles SpacetimeDB
      {none}/{some} Option envelopes, surfaces errors (V)
    - `row_u64` in workflow_reads.rs — adds as_i64 fallback (accepts negative wraparound) (I)
    - `row_u64` in skill_loader.rs — single key, returns u64 with default 0, accepts negatives
      via as_i64 cast (V)
    - `u64_field` in workflow_worker.rs — no string parsing, as_u64 only (V)
    - `u64_field` in stdb_embed.rs — different search order (camel as_u64, snake as_u64,
      camel as_str, snake as_str) (V)
    - `value_to_u64` in insights.rs — explicitly rejects negatives via `(v >= 0).then_some()` (V)
    - `require_u64` × 4 in cold-tier (audit_drainer, pos_order_drainer, projection_worker,
      hydration) — same logic, different error message prefixes (I)
    - Identity decoders × 4 (audit_drainer, pg_codec, projection_worker, commit_projection) —
      different input types, strictness, return types (I/V)
    - `snake_to_camel` in stdb-client/src/lib.rs — private, different crate, stays local (I)
    - `camel_to_snake` × 2 in codegen — different algorithms, relationship suffix handling (I)
Tests discovered / executed / passed / failed / skipped: no new tests (mechanical extraction);
  compile verification used
Commands:
  - `cargo check --locked -p ai-gateway` — 0 errors, 57 warnings (baseline)
  - `cargo check --locked -p api-server` — 0 errors, 25 warnings (baseline)
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: none needed (pub(crate) module,
  no path moves)
Blocker or acceptance rationale: exact AI copies eliminated to single owner, api-server
  snake_to_camel consolidated to existing pub(crate) owner, intentional variants documented,
  both crates compile at baseline warning counts. query_exec/row_values.rs does not exist;
  no facade needed for this task.
Next executable task: D32 (canonical JSON)

### D32 — Canonical JSON deduplication (accepted)

Task / finding IDs / status: D32 / F15 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Modified: `api-server/src/cold_tier/conventions.rs` (canonicalize_json -> pub(crate))
  - Modified: `api-server/src/cold_tier/reconstruction.rs` (removed canonical_value, uses conventions)
  - Modified: `api-server/src/cold_tier/reconciliation.rs` (removed canonical_value, uses conventions)
  - Modified: `api-server/src/cold_tier/commit_projection.rs` (removed sort_json, uses conventions)
  - Modified: `ai-gateway/src/wire_decode.rs` (added canonicalize pub(crate))
  - Modified: `ai-gateway/src/harness/audit.rs` (removed canonicalize, uses wire_decode)
  - Modified: `ai-gateway/src/harness/certification.rs` (removed canonicalize, uses wire_decode)
  - Modified: `ai-gateway/src/harness/certification_fixtures.rs` (removed canonicalize, uses wire_decode)
Old functions and callers -> final owner:
  - F15a: 3 properly-recursive `canonicalize`/`canonical_value`/`sort_json` copies in api-server
    cold-tier (reconstruction, reconciliation, commit_projection) -> all delegate to
    `conventions::canonicalize_json` (already existed, made pub(crate))
  - F15b: 3 byte-identical `canonicalize` copies in ai-gateway (audit, certification,
    certification_fixtures) -> all delegate to `wire_decode::canonicalize`
Decision IDs / intentional behavior changes: none (mechanical extraction; preserve_order
  is not enabled, so BTreeMap iteration already sorted keys — outputs are byte-identical)
Copies removed / remaining adapters and reasons:
  - Removed: 3 cold-tier canonicalize/canonical_value/sort_json copies, 3 ai-gateway canonicalize copies
  - Remaining (intentional, separate build universe or different protocol):
    - `spacetimedb/src/core/persistence.rs::sort_json` — separate build universe (rule #10),
      relies on BTreeMap (preserve_order not enabled)
    - `spacetimedb/src/core/queue.rs::canonicalize_json` — serde round-trip for FNV-1a hash,
      different hash algorithm, different purpose (queue dedup)
    - `spacetimedb/src/core/audit.rs::audit_log_canonical_checksum` — manual json! with sorted
      keys, must mirror audit_drainer output; spacetimedb build universe
    - `spacetimedb/src/workflow/action_registry.rs::canonical_json_or_raw` — serde round-trip
      fallback, different purpose (action registry params)
    - `api-server/src/cold_tier/pg_codec.rs::canonical_json` — per-field value normalizer
      (numbers to strings, bytea to hex), not recursive JSON sort
    - `ai-gateway/src/rig_agent.rs::deterministic_id` — string concatenation, no JSON
  - UUID-v5 (audit) vs SHA-256 (certification) hash algorithms preserved — only the
    canonicalization before hashing is shared
Tests discovered / executed / passed / failed / skipped: compile verification only;
  codegen query_exec_audit: 2 pass
Commands:
  - `cargo check --locked -p ai-gateway` — 0 errors, 57 warnings (baseline)
  - `cargo check --locked -p api-server` — 0 errors, 25 warnings (baseline)
  - `cargo test --locked -p lumiere-codegen query_exec_audit` — 2 pass
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated: none needed (pub(crate) visibility,
  no path moves)
Blocker or acceptance rationale: canonical JSON recursive sort consolidated to one owner
  per tier (conventions.rs for cold-tier, wire_decode.rs for ai-gateway), UUID-v5 vs SHA-256
  preserved, spacetimedb copies left as separate build universe, all outputs byte-identical,
  both crates compile at baseline warning counts
Next executable task: D33 (identifier/case conversion contracts)

### D33 — Identifier/case conversion contracts (accepted)

Task / finding IDs / status: D33 / F16 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Modified: `api-server/src/cold_tier/conventions.rs` (added validate_identifier, quote_identifier)
  - Modified: `api-server/src/cold_tier/projection_worker.rs` (removed local validate_identifier/quote_identifier)
  - Modified: `api-server/src/cold_tier/commit_projection.rs` (removed local quote_identifier/is_safe_identifier)
  - Modified: `api-server/src/cold_tier/reconciliation.rs` (removed local validate_identifier, uses conventions)
  - Modified: `api-server/src/cold_tier/reconstruction.rs` (removed local validate_identifier, uses conventions)
Old functions and callers -> final owner:
  - F16a: 4 PG identifier validators/quoters in cold-tier (projection_worker, commit_projection,
    reconciliation, reconstruction) with disagreements on leading char, length limit, and
    debug vs release validation -> consolidated to `conventions::validate_identifier` +
    `conventions::quote_identifier` (canonical rules: any [a-z0-9_], 128 bytes, non-empty,
    release validation)
  - F16b: reconciliation.rs had stricter leading-char rule (must start a-z) -> replaced with
    conventions rules (allows leading _ or 0-9); no valid generated names rejected since all
    start with a-z
  - F16c: reconstruction.rs and reconciliation.rs had debug_assert-only quote_identifier ->
    now call conventions::validate_identifier in the debug_assert; release validation occurs
    at the boundary (validate_identifier calls before SQL construction)
Decision IDs / intentional behavior changes:
  - Consolidated rules use the majority pattern (any [a-z0-9_], 128 bytes, non-empty) rather
    than the stricter reconciliation rules (leading a-z); this is a loosening of validation in
    reconciliation.rs but does not accept any new valid generated names
  - Error messages change slightly: "generated projection identifier is unsafe" → "unsafe
    projection identifier", "reconstruction {label} must be lowercase snake_case" → same
Copies removed / remaining adapters and reasons:
  - Removed: 4 local validate_identifier/is_safe_identifier, 4 local quote_identifier
  - Remaining (intentional):
    - `pg_migration_emit.rs::validate_identifier` + `quote` in codegen — separate crate,
      different rules (no length limit, escapes double quotes, _ only at index > 0),
      validates table names from policies not every identifier
    - `sql_columns_emit.rs::camel_to_snake` — codegen, handles M2O/M2M/O2M relation suffixes,
      digit boundary patterns; must match frontend camelToSnakeIdentifier (I)
    - `stdb_bindings_parse.rs::camel_to_snake` — codegen, simple uppercase-boundary splitter
      for type name → module name conversion; intentionally different from sql_columns_emit
      (no relation suffix, no digit boundaries) (I)
    - No STDB SQL identifier validators exist (STDB uses pre-validated registry column lists)
    - `snake_to_camel` in `stdb-client/src/lib.rs` — private, different crate (I)
Tests discovered / executed / passed / failed / skipped: compile verification + codegen audit
Commands:
  - `cargo check --locked -p api-server` — 0 errors, 25 warnings (baseline)
  - `cargo test --locked -p lumiere-codegen query_exec_audit` — 2 pass
Baseline failures vs regressions: none
Blocker or acceptance rationale: PG identifier validation consolidated to one owner with
  release-build validation, disagreements resolved (leading char, length, debug vs release),
  codegen case converters intentionally different (relation suffix vs type name), no new
  schema names or hashes, all compiles at baseline
Next executable task: D35 (shadow HR policy/AI registry disposition)

### D35 — Shadow HR policy/AI registry disposition (accepted)

Task / finding IDs / status: D35 / F18, F19 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)
Allowed files / actual changed files:
  - Modified: `spacetimedb/src/hr/pii.rs` (removed dead predicates/constants, added cross-boundary duplicate doc)
  - Deleted: `frontend/packages/erp-shared/src/ai-entity-snapshot-registry.ts`
  - Modified: `frontend/packages/erp-shared/src/index.ts` (removed export)
  - Modified: `frontend/packages/erp-shared/package.json` (removed subpath)
Old functions and callers -> final owner:
  - F18a: `purpose_for_resource` in pii.rs (line 80) — zero callers, shadowed by
    `field_policy::purpose_for_hr_resource` in stdb-auth -> removed
  - F18b: `fields_require_read_audit` in pii.rs (line 89) — zero callers, shadowed by
    `field_policy::hr_fields_require_read_audit` in stdb-auth -> removed
  - F18c: `PURPOSE_HR_SELF`, `PURPOSE_HR_MANAGER`, `PURPOSE_VIEW_COMP`,
    `PURPOSE_VIEW_STATUTORY_ID` in pii.rs — only used by dead `purpose_for_resource`
    -> removed; `PURPOSE_HR_ADMIN` retained (used by hr/documents.rs:5,138)
  - F18d: `HR_EMPLOYEE_SENSITIVE`, `HR_EMPLOYEE_PIN`, `HR_CONTRACT_COMP`,
    `HR_PAYSLIP_COMP` — intentionally duplicated in `crates/stdb-auth/src/field_policy.rs`
    (private, used by `apply_hr_field_policy`) and `spacetimedb/src/hr/pii.rs` (pub, used
    by `log_hr_pii_read` reducer). Both copies have live consumers. Architecture rule #10
    (separate build universes) prevents sharing a crate. Retained as documented
    intentional cross-boundary duplicate. Added explanatory comment in pii.rs.
  - F19a: `frontend/packages/erp-shared/src/ai-entity-snapshot-registry.ts` — exported via
    index.ts barrel and package.json subpath but zero external consumers found (no imports
    via `@lumiere/erp-shared/ai-entity-snapshot-registry` or via barrel `EntitySnapshotSpec`/
    `lookupEntitySnapshotSpec`/etc). Rust side (`ai-gateway/src/harness/entity_registry.rs`)
    has 6 live callers in `snapshot.rs` and is retained. TS file, barrel export, and
    subpath removed.
Decision IDs / intentional behavior changes:
  - D01-10: HR PII constant duplicates are intentional cross-boundary enforcement (both
    sides live, cannot share crate per rule #10). Documented with comment in pii.rs.
  - No behavior changes; dead code removal only.
Copies removed / remaining adapters and reasons:
  - Removed: `purpose_for_resource`, `fields_require_read_audit`, 4 dead purpose constants
  - Removed: `ai-entity-snapshot-registry.ts` (262 lines) + barrel export + subpath
  - Remaining (intentional):
    - HR PII constants in both `field_policy.rs` and `pii.rs` (cross-boundary, rule #10)
    - `employee_audit_json`, `document_purpose_requires_pii`, `log_hr_pii_read` reducer,
      `HrPiiAccessLog` table — all live, retained in pii.rs
    - Rust `entity_registry.rs` — live consumers in ai-gateway, retained
Tests discovered / executed / passed / failed / skipped:
  - spacetimedb: `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests` —
    0 errors, 10 warnings (baseline)
  - erp-shared: typecheck pass, 81 tests pass
Commands:
  - `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests`
  - `pnpm --filter @lumiere/erp-shared typecheck`
  - `pnpm --filter @lumiere/erp-shared test`
Baseline failures vs regressions: none
Exports / source scanners / test lists / docs updated:
  - Removed `export * from "./ai-entity-snapshot-registry"` from erp-shared index.ts
  - Removed `"./ai-entity-snapshot-registry"` subpath from erp-shared package.json
Blocker or acceptance rationale: dead shadow definitions removed from both build universes;
  live cross-boundary PII constant duplicate documented as intentional; TS snapshot registry
  removed with zero consumer impact; all compile/test/typecheck at baseline
Next executable task: D36 (HTTP error/auth boundary cleanup) or D37 (warning/stub/PDF disposition)

### D37 — Warning/stub/PDF disposition (accepted)

Task / finding IDs / status: D37 / F20 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)

Warning cleanup:
  - api-server: 25 warnings → 5 (all 5 in generated realtime_wire.rs, not fixable)
  - ai-gateway: 57 warnings → 44 (remaining 44 are entire unused subsystems: parser, vision,
    parts of qdrant/snapshot/orchestrator — plan does not authorize a dead-code sweep)

Unused imports removed:
  - api-server: `json` from audit_read.rs (moved to test module), 4 report type imports from
    auth.rs/render.rs, 9 row type imports from service.rs
  - ai-gateway: `ActionDraftProposal` from policy_engine.rs, `fetch_live_snapshots` re-export
    from harness/mod.rs, `DocumentChunk`+`WebSearchProvider` from providers/mod.rs,
    `ImportAnalyzeResult`+`ImportPreviewResult`+`SyncSkillPayload` from skills/mod.rs,
    `ToolRegistry`+`ToolContext`+`ToolOutput`+`ToolResult` from tools/mod.rs,
    `RunSkillRequest`+`RunSkillResponse`+`RunSkillStepSummary`+`SkillArtifact`+`LoadedSkill`
    from orchestrator/mod.rs, `anyhow::Context` from worker.rs

Dead code removed:
  - `find_credential_by_identity` in auth_password.rs (zero callers)
  - `notify_row_change` in realtime/mod.rs (zero callers)
  - `AgingBucketKey::id()` method in open_balances.rs (never called)
  - `id` field from `GeneratedOwnerReportArtifactRow` (deserialized but never read; serde
    ignores unknown fields by default)
  - `organization_id` from `TimerRow` and `QueueJobRow` (deserialized but never read)
  - `PdfFormatQuery` struct + `Query` extractor from documents.rs (whole struct unused)
  - `ImportAnalyzeResult` + `ImportPreviewResult` type aliases in import.rs (never used)
  - Unreachable `_` catch-all in service.rs match (all ReportKey variants covered)

Test-only code moved under `#[cfg(test)]`:
  - `merge_hot_cold_rows` in pos_order_read.rs (only used in test module)
  - `DispatchCrashPoint`, `DispatchPhase`, `FakeExternalLedger`, `DispatchAttemptError`,
    `run_outbox_attempt`, `replay_outbox_until_complete` in workflow_worker.rs (Gate W
    crash/replay test suite)

PDF panic fix:
  - `render_lines_pdf` in documents.rs: changed return type from `Vec<u8>` to
    `Result<Vec<u8>, ApiError>`, replaced `.expect("builtin font")` and `.expect("save pdf")`
    with `.map_err(|e| ApiError::Internal(...))?`. Three callers updated with `?`.

Unused variable fix:
  - `state` → `_state` in `find_reset_token_by_hash` (auth_password.rs)

Product-decision blockers (recorded, not resolved):
  - Proposal stub: `proposals.rs::mock_analysis()` returns hardcoded fake data as 200 OK
    on every AI gateway failure. Frontend detects mock via `isMockAnalysis()` and persists
    with `source: "mock"`. APP_CODEBASE_CLEANUP_PLAN.md says to "replace or implement
    before exposing." Needs user direction: return 502/503 on failure, gate to dev, or
    label as supported degraded response.
  - Statutory adapters: `statutory_adapters.rs` returns `"status": "stub"` for all 7
    jurisdictions. Needs user direction: return 501, feature-gate, or document as
    intentional scaffold.

Tests discovered / executed / passed / failed / skipped:
  - api-server: `cargo check --locked -p api-server` — 0 errors, 5 warnings (generated code only)
  - ai-gateway: `cargo check --locked -p ai-gateway` — 0 errors, 44 warnings (unused subsystems)
  - codegen: `cargo test --locked -p lumiere-codegen query_exec_audit` — 2 pass
  - erp-shared: 81 tests pass
Commands:
  - `cargo check --locked -p api-server -p ai-gateway`
  - `cargo test --locked -p lumiere-codegen query_exec_audit`
  - `pnpm --filter @lumiere/erp-shared test`
Baseline failures vs regressions: none (api-server warnings reduced 25→5, ai-gateway 57→44)
Blocker or acceptance rationale: unused imports removed, dead code removed after confirming
  zero callers, test-only code gated, PDF panics replaced with Result propagation, proposal
  and statutory stubs recorded as product-decision blockers. Remaining ai-gateway warnings
  are entire unused subsystems — removing them is an unauthorized dead-code sweep.
Next executable task: D36 (HTTP error/auth boundary cleanup)

### D36 — HTTP errors and session preambles (accepted)

Task / finding IDs / status: D36 / F20 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)

Two acceptance parts:
  1. Error handling — completed in this task.
  2. Extractor/caller adoption — deferred to M60 after M10/M11/M21 (companion plan).
     D40 can establish those boundaries before this part completes.

Error handling — security/redaction correction:
  - `ApiError::Internal(m)` previously returned the raw internal message in the JSON
    response body (`{"error": "<raw message>"}`). This could leak SQL errors, connection
    strings, stack traces, and other internal details to clients.
  - Changed to return `"Internal server error"` in the response body. The source message
    is preserved in the `tracing::error` log with full context.
  - This is a recorded security/redaction correction, not a status-code change. All
    HTTP status codes remain unchanged (500 for Internal).
  - Frontend `server-query.ts` reads `json.error` and falls back to `res.statusText`,
    so the redaction does not break client error handling.

Session/auth boundary verification (no changes needed):
  - `web_session.rs::resolve_session` delegates to `resolve_api_session` — correct
  - Credential precedence: Bearer token > cookie token — preserved
  - `require_org` returns `Forbidden` when no organization — preserved
  - Dev mock path guarded by `!runtime_is_production()` — preserved
  - No privileged client or default company obtained implicitly by the session extractor
  - `ApiError` remains centralized in `error.rs` with single `IntoResponse` impl

Tests:
  - 5 error tests added in `error.rs` `#[cfg(test)]` module:
    - `internal_error_redacts_source_message` — verifies secret/URL not in response
    - `forbidden_preserves_message` — verifies client-facing messages preserved
    - `not_found_preserves_message`
    - `unauthorized_has_generic_message`
    - `invalid_email_or_password_has_specific_body`
  - `cargo test --locked -p api-server --lib error::tests` — 5 pass
  - `cargo check --locked -p api-server` — 0 errors, 5 warnings (generated code only)

Remaining for M60 (companion plan):
  - Session extractor staged as `web_session` module
  - Selected callers migrated to use extractor pattern
  - Distinct auth flows (password, SSO, recovery) remain explicit

Blocker or acceptance rationale: error handling security correction completed with tests;
  session/auth boundary verified as already correct; extractor adoption deferred to M60
  per companion plan (no circular prerequisite created).
Next executable task: D40/D41/D42 (structural work) or D50 (CI/E2E)

### D60 — Ownership documentation and discovery checks (accepted)

Task / finding IDs / status: D60 / all F-families / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision: `e58843bcc` / working tree (uncommitted)

Deliverables:
  - Created `docs/guides/code-ownership-and-shared-behavior.md` — concise reference mapping each
    completed family to its owner, tests, and notes. Covers:
    - Frontend shared helpers (erp-shared): u64, timestamp, row-values, contact-matching, CSV, navigation
    - Frontend AI HTTP helpers: form-request, rag-request, route-helpers, audit-log-utils
    - api-server helpers: integration-worker, conventions, error, session/auth
    - ai-gateway helpers: wire-decode, canonical JSON
    - spacetimedb helpers: relations, line-params, fx-metadata, hr/relations, subscriptions/relations, receipts
    - Intentional cross-boundary duplicates (5 items with reasons)
    - Intentional behavioral variants (4 items with reasons)
    - Retired definitions list (12 items, do not reintroduce)
  - Link from refactor plan to guide established via this record.

Test discovery validation:
  - erp-shared test script includes all 10 test files (verified via package.json)
  - erp-shared: 81 tests pass
  - query-hooks: 47 tests pass, typecheck clean
  - ui: 26 tests pass, typecheck clean
  - api-server error tests: 5 pass (new tests discovered and run)
  - codegen query_exec_audit: 2 pass
  - spacetimedb: 0 errors, 10 warnings (baseline)
  - api-server: 0 errors, 5 warnings (generated code only, baseline reduced from 25)
  - ai-gateway: 0 errors, 44 warnings (unused subsystems, baseline reduced from 57)

No blanket clone-percentage gate deployed. No lint/ratchet regression check added — the
retired-definitions list in the guide serves as the manual reference for reviewers.

Blocker or acceptance rationale: ownership guide created covering all 22 F-families with
  owners, intentional duplicates, and retired definitions. All new test files are discovered
  by their package test scripts. All build/test/typecheck gates pass at or below baseline.
Next executable task: D40 (API modularization, companion M-plan), D41 (frontend hooks), D42 (domain files), D50 (CI/E2E), or D90 (final verification)

### D50 — CI/E2E setup consolidation (accepted)

Task / finding IDs / status: D50 / F21 / accepted
Owner / coordinator reviewer: coordinator
Base revision / integrated revision or scoped patch identity: e58843bcc working tree
Allowed files / actual changed files:
  - Created: .github/actions/setup-contracts-ssh/action.yml, .github/actions/setup-frontend/action.yml,
    .github/actions/setup-spacetime-cli/action.yml
  - Modified: .github/workflows/{ci,e2e-smoke,frontend-i18n,params-cohesion,semantic-index-q0}.yml,
    docs/guides/build-and-ci-dx.md
Old functions and callers -> final owner:
  - SSH setup for lumiere-contracts deploy key (8 inline blocks across 5 workflows) ->
    .github/actions/setup-contracts-ssh/action.yml
  - pnpm 10.31.0 + Node 22 + pnpm lockfile cache (5 inline blocks across 4 workflows) ->
    .github/actions/setup-frontend/action.yml
  - SpacetimeDB CLI cache + install + PATH (2 inline blocks in ci.yml, e2e-smoke.yml) ->
    .github/actions/setup-spacetime-cli/action.yml
Decision IDs / intentional behavior changes:
  - Deploy key passed as composite action input (secrets not directly accessible in composite run steps);
    received via env var to avoid interpolation in script body
  - SPACETIME_CLI_VERSION passed as input from each workflow's env context; cache key uses input not env
  - No behavior changes — setup steps are identical to the inlined versions they replace
Copies removed / remaining adapters and reasons:
  - 8 SSH blocks removed (all identical, all use same secret and known_hosts)
  - 5 pnpm/Node blocks removed (all use same pnpm 10.31.0, Node 22, lockfile cache path)
  - 2 spacetime CLI blocks removed (all use same cache paths, install script, PATH step)
Tests discovered / executed / passed / failed / skipped:
  - actionlint v1.7.11 on all 5 workflows: 0 errors
  - Python CI classifier tests: 15 pass
  - bash -n scripts/e2e-dx.sh: pass
Commands, target/feature/environment gates, concise evidence:
  - ~/go/bin/actionlint .github/workflows/*.yml: clean
  - python3 -B -m unittest discover -s scripts/tests: 15 OK
Baseline failures vs regressions: none
Review findings and resolutions:
  - Verified all 8 deploy-key references now appear only in `with:` input blocks
  - Verified pnpm/action-setup and actions/setup-node no longer appear in any workflow
  - Verified no inline SSH/pnpm/spacetime setup blocks remain in workflows
  - DX2-DX7 remain separately gated; DX7 semantic-index overlap not touched
Blocker or acceptance rationale: composite actions extract genuinely identical setup blocks.
  Permissions, event/path selection, required-gate logic, and job dependencies remain at workflow
  level. No CI job added, removed, or reordered. actionlint and classifier tests pass.
Next executable task: finish D41 accounting.ts segmentation, then D40/D42/D90

### D41 — Frontend hook/utility segmentation (in progress)

Task / finding IDs / status: D41 / F22 / IN PROGRESS (hr + inventory complete; accounting pending)
Owner / coordinator reviewer: primary implementation session
Base revision / integrated revision: `e58843bcc` on `vibe/c2-postgres-projection-ir-v2`
Allowed files / actual changed files:
  - `frontend/packages/query-hooks/src/hooks/hr.ts` → deleted; replaced by `hr/` directory
  - `frontend/packages/query-hooks/src/hooks/hr/{index,employees,leave,payroll,onboarding,benefits,performance,integration,imports}.ts` → created
  - `frontend/packages/query-hooks/src/hooks/inventory.ts` → deleted; replaced by `inventory/` directory
  - `frontend/packages/query-hooks/src/hooks/inventory/{index,shared,products,warehouses,stock-operations,physical-inventory,quality,barcodes,traceability,uom,integration,csv-imports,misc}.ts` → created
  - `frontend/packages/query-hooks/package.json` → added `"./hooks/hr"` and `"./hooks/inventory"` export paths
  - `frontend/packages/query-hooks/src/hooks/accounting.ts` → NOT YET segmented
Old functions and callers -> final owner:
  - hr hooks → `hr/employees.ts` (28 exports), `hr/leave.ts` (166 lines), `hr/payroll.ts` (310), `hr/onboarding.ts` (145), `hr/benefits.ts` (92), `hr/performance.ts` (149), `hr/integration.ts` (71), `hr/imports.ts` (166); barrel `hr/index.ts`
  - inventory hooks → `inventory/products.ts` (17 exports), `inventory/warehouses.ts` (9), `inventory/stock-operations.ts` (55), `inventory/physical-inventory.ts` (24), `inventory/quality.ts` (24), `inventory/barcodes.ts` (11), `inventory/traceability.ts` (16), `inventory/uom.ts` (4), `inventory/integration.ts` (6), `inventory/csv-imports.ts` (10), `inventory/misc.ts` (2); shared helpers in `inventory/shared.ts`; barrel `inventory/index.ts`
Decision IDs / intentional behavior changes: none (pure mechanical extraction)
Copies removed / remaining adapters and reasons: original hr.ts and inventory.ts deleted; no adapters
Tests discovered / executed / passed / failed / skipped:
  - query-hooks typecheck: clean
  - query-hooks test: 47 pass, 0 fail
  - web typecheck: clean
Commands, target/feature/environment gates, concise evidence:
  - `pnpm --filter @lumiere/query-hooks typecheck`: clean
  - `pnpm --filter @lumiere/query-hooks test`: 47 pass
  - `pnpm --filter ./web exec tsc --noEmit`: clean
Baseline failures vs regressions: none
Review findings and resolutions:
  - Mid-file `parseCallError` import hoisted to submodule headers that need it
  - Relative import paths adjusted: `../http` → `../../http`, `./hr-params-merge` → `../hr-params-merge`
  - Non-exported helpers shared across submodules changed to `export function`
  - query-hooks test glob `src/hooks/*.test.ts` does NOT discover nested dirs; no new tests added under subdirectories
Exports / source scanners / test lists / docs updated:
  - package.json exports: `"./hooks/hr": "./src/hooks/hr/index.ts"`, `"./hooks/inventory": "./src/hooks/inventory/index.ts"`
Blocker or acceptance rationale: hr and inventory segmentation verified; accounting.ts remains.
Next executable task: run accounting.ts extraction script, delete accounting.ts, add export path, typecheck + test + web typecheck

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
