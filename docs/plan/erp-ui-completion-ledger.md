# ERP UI completion execution ledger

**Status:** Proposed; all packages below are TODO until accepted implementation evidence exists.  
**Created:** 2026-09-14.  
**Specification:** [ERP UI design-system completion](../plans/erp-ui-design-system-completion-plan.md).  
**Program:** [coordination](erp-harness-implementation-coordination-plan.md), [COV module parity](erp-module-usability-parity-ledger.md), [COH ownership](repository-cohesion-outcome-ownership-ledger.md).

## 1. Assignment and acceptance rules

UX packages improve shared UI contracts, components and proof. COV packages remain responsible for completing each module's business workflows and adopting the applicable shared UI. COH owns outcome/authority semantics; INT owns cross-domain workflow composition; the existing frontend-IR program owns its compiler, dictionary and admission lifecycle. These are not duplicate execution lanes.

Use the main ledger statuses: TODO, ACTIVE, REVIEW, BLOCKED, ACCEPTED and DEFERRED. A deferred required workflow remains incomplete. Record status, owner, accepted base, exact files, producer/publisher/consumer role, result evidence and next bounded task in the coordinator's assignment record. No acceptance is implied by this initial ledger.

Before implementation, UX-00 reconciles PR #44's planning baseline with the separate presentation-IR implementation stack and the accepted contracts release. Reuse delivered save/reopen, validators and renderer hosts. A package absent from the planning branch is not necessarily unimplemented.

One worker owns one bounded objective. Split any package that crosses a new contract release, independent workflow or ownership boundary. A large module is never assigned as one UI task. No automatic rewrite of the library, theme system, chart engine, form engine, reporting runtime or query cache is authorized.

Every return includes: affected callers; canonical owners reused/retired; before/after behavior; generated input/output and error semantics; tests actually run; screenshots from the actual renderer where applicable; remaining evidence gaps; and contract release requirements. Source-only review, mock fixture proof, integrated E2E and human usability evidence are separate statuses.

## 2. Shared foundations and corrections

| ID | Prerequisites | Ownership envelope | Bounded objective | Acceptance evidence |
| --- | --- | --- | --- | --- |
| UX-00 | BASE-00, COV-00 current inventories | UI/config/IR census and fixture selection; no speculative runtime | Reconcile exact baseline/contract pins, existing UI owners, static versus persisted definitions, source findings UI-F01..11 and current module callers. Select three reference workspaces and a small component-state gallery. | One source-to-workflow map with delivered/partial/missing evidence; exact accepted revision; no duplicate IR package planned; no module disappears from scope. Existing fixture tooling and executable commands identified. |
| UX-01 | UX-00 | Existing token/palette/shell CSS, typography and density primitives | Establish neutral default and proposed Warm preset using existing semantic tokens; define safe density spacing and stable status/chart role tokens. Keep existing presets compatible. | Actual component fixtures in both presets/light/dark; text/control/chart contrast measurements; focus, disabled, destructive and long-label states; no theme-driven business behavior or per-module palette fork. |
| UX-02 | UX-00; UX-01 before final preset proof | Existing ThemeProvider and server/first-paint integration only | Harden storage unavailable/corrupt behavior, explicit defaults, system-mode initialization and theme persistence. Add approved preset/density selection through existing settings owner. | Tests for blocked storage, invalid values, configured defaults, system changes, reload and first paint; no second provider; user accessibility preferences preserved; configuration remains presentation-only. |
| UX-03 | UX-00, accepted COH-02/10 outcome contract | Shared panel/resource-state and action-feedback adapters | Represent ready/empty/loading/refreshing/stale/partial/denied/error/invalid-definition without collapsing them to empty arrays or zero. Reuse typed operation outcomes for messages and recovery. | Each state has focused fixture and keyboard/live-announcement behavior; failed query never appears as an empty successful list; unknown effect offers reconciliation rather than blind retry. No new global error taxonomy. |
| UX-04 | UX-03, COV-01 shared workflow seam | ModuleView/EntityView/EntityTable toolbar and navigation integration | Fix tab keyboard semantics; standardize effective filter/view/company context, row links and scoped preferences. Distinguish bounded complete data from server pagination. | Keyboard tab/arrow proof, accessible row opening, late-response/company-switch test, back/reopen filter preservation, correct filtered counts/export scope; no sums over a server page presented as full totals. |
| UX-05 | UX-03, COV-01 | Existing record sheet/workspace composition and shared action chrome | Establish record header, canonical status/next action, related-record links and supporting history/attachments using current domain result refs. | One existing order/invoice record demonstrates action pending/rejection/waiting, linked result navigation and canonical readback; no local domain transition engine, new generic manager or mandatory modal for long editing. |
| UX-06 | UX-00, accepted generated field contracts | Runtime form merger, field identity/type adapters and focused tests | Replace ambiguous matching on the selected migration path; preserve MultiSelect cardinality, supported field types and missing/null/clear semantics. Keep explicit versioned compatibility maps only where required. | Multi-value round-trip, alias collision, unknown type, relation option revocation and patch clear/preserve tests; unsupported binding produces diagnostic. Missing producer metadata becomes a release dependency, not a handwritten shadow schema. |
| UX-07 | UX-03, UX-06, COV-01 | FormModal/ModularForm submit host and selected callers | Remove false-success paths, resolve one submit owner and map typed field/global diagnostics. Preserve dirty values, focus and recovery through failures/waits. | No handler/config-only handler/conflicting handler tests; Applied/replay/rejected/waiting/outcome-unknown behavior; no Saved toast or close on missing/failed action; stale-save recovery and dirty-dismiss keyboard tests. |
| UX-08 | UX-00; reuse accepted analytics/contract owners | Stored dashboard resolver, its approved bindings and tests | Stop invalid filters/unknown operators from broadening results. Make aggregation, time-field decoding, missing values and completeness explicit for existing supported report bindings. | Malformed filter/operator, unknown measure, null versus zero, missing timestamp, timezone boundary and partial dataset fixtures; invalid-definition card rather than plausible incorrect totals. Do not implement a second query language or financial calculation engine. |
| UX-09 | UX-01, UX-03, UX-08 | Existing Recharts widget renderers and shared format/inspection adapters | Implement truthful units, axes, series identity, gaps, responsive sizing, accessible inspection and table alternatives for existing chart families. | Positive/negative/zero/missing/comparison fixtures, stable series colors after sort/filter, keyboard/touch readout, reduced motion, long labels and drill-through; benchmark named datasets before any chart-engine replacement. |
| UX-10 | UX-01, UX-03, UX-08 | Shared card chrome and existing report/export adapters | Distinguish KPI, saved-report definition, generated artifact and forensic record cards; fix keyboard semantics/localization and export feedback. | Scope/period/freshness/validation visible as applicable; compact card keyboard opening; correct authorized export with pending/error state; report render does not execute expensive work; no universal report business model. |

## 3. Presentation IR integration

These packages are contract-family assignments, not permission to recreate PR #25/#32 functionality. UX-00 must replace historical assumptions with the accepted integrated code. Source producers may prototype against explicit fixtures, but production consumers cannot depend on an unpublished contract.

| ID | Prerequisites | Ownership envelope | Bounded objective | Acceptance evidence |
| --- | --- | --- | --- | --- |
| UX-11A | UX-00, UX-06; existing IR validator/dictionary accepted | Rust presentation-core editor/action model producer | Add only the missing renderer-neutral form/editor/action-reference semantics required by one reference workspace. Bind generated field/operation identities and approved component versions. | Strict schema/validator tests for identity, type/cardinality, unsafe keys and incompatible versions; no callbacks/JS/reducer strings/permission grants in persisted definitions. Stop at producer handoff. |
| UX-11B | UX-00, UX-08; existing IR validator/dictionary accepted | Rust presentation-core metric/series/report model producer | Add only the missing metric/series/report-reference family; reconcile existing static dashboard definitions rather than create a third schema. | Unit/currency/time/quality/bounds/ref validation, unknown nodes rejected, no raw SQL or unbounded query semantics. Separate commit/owner from editor family if shared files collide. |
| UX-12 | Accepted UX-11A and/or UX-11B producer batch | Coordinator's existing codegen/release lane | Generate deterministically, validate compatibility, publish immutable contracts and record the exact pin. May execute once per accepted family batch. | Existing schema, IR, operation-history, tenant/storage and release compatibility gates; no generated output hand-editing, no movement of business/codegen logic to generated-output repository. Publisher evidence explicitly recorded. |
| UX-13A | UX-12 editor release, UX-05/06/07 | Pinned presentation form/action consumer adapters | Connect the released definitions to existing form/workspace renderers and generated operations for the reference workflow. | Same values, validation, approved effect and error behavior from static and persisted definition; no eval/custom serialized function; stale/denied definition fails safely. |
| UX-13B | UX-12 report release, UX-08/09/10 | Pinned presentation chart/report consumer adapters | Connect the released report family to existing dashboard/chart/card components and approved data bindings. | Matching chart/table/export scope, bounded acquisition, meaningful incomplete states, strict decoding, no automatic report/model/sandbox run on mount. |
| UX-14 | UX-13A/B as applicable; existing frontend-IR save/reopen accepted | Existing admin composer and preview surface | Add supported UI options/preview to the current human-authored composition flow. Reuse revision/conflict semantics. Publication/activation belongs to its existing milestone, not a parallel lifecycle. | Save/reopen preserves exact supported configuration; late response cannot replace newer edits; unauthorized binding rejected; invalid config clearly diagnosed. Publish remains BLOCKED until existing lifecycle owner supplies proof; no mutation on preview. |

UX-11A/B share Rust model/validator files in the current pilot. Run them serially or explicitly transfer file ownership; they are not independent parallel workers merely because the semantic families differ. UX-12 never executes concurrently with another release lane.

## 4. Reference adoption and all-module proof

These rows are integration checkpoints **performed by the existing COV owners**, not extra assignments to reimplement the same module.

| ID | Prerequisites | Ownership envelope | Bounded objective | Acceptance evidence |
| --- | --- | --- | --- | --- |
| UX-15A | Relevant UX-03..07; accepted sales/accounting workflow | COV order/invoice owner | Adopt the shared shell/record/form/outcome patterns in one complete transactional workspace. | List -> record -> edit -> submit -> canonical readback -> linked downstream record; exact amounts and stale/error recovery. Real browser evidence in neutral/Warm modes. |
| UX-15B | Relevant UX-04/05/08/09; accepted inventory/manufacturing workflow | COV inventory/manufacturing owner | Prove an operational record and its quantities/quality/analysis surface. | Contextual action -> canonical result -> chart/table drill-through; partial data, missing inventory, denied action and reconnect states. No fabricated local status. |
| UX-15C | UX-10 and admitted UX-13B/14 scope | COV reports/admin owner | Prove saved report configuration, period/scope interpretation and accessible output. | Select period/measure -> compare chart/table -> save/reopen -> authorized export; invalid definition and no-data/error distinction. Unsupported publish remains visibly unavailable, not falsely successful. |
| UX-16 | Reference proofs; applicable COV adoption rows complete | COV-26/27 coordinator and existing test harness | Run the all-module UI acceptance matrix alongside U5 workflow evidence. Split execution by module family rather than one unbounded fix task. | Actual renderer visual captures, keyboard/manual and automated accessibility, both presets/modes, meaningful states, 320px reflow/zoom and named responsive widths; no unclassified module or hidden denominator reduction. Product defects return to the owning package. |
| UX-17 | UX-16 candidate, COV-02 first-org fixture | Product owner and first-org representatives | Conduct task-based usability checks and triage observed confusion/error recovery/report interpretation. | Record actual human task observations and follow-up defect IDs. Do not fabricate human testing, infer usability from brand reputation or count an agent walkthrough as human evidence. |

Every other COV module gains an adoption record under its existing ledger. The shared test fixture suite reduces repeated primitive testing, but does not replace module-specific canonical action/readback and denied/error workflow tests.

## 5. Recommended sequencing

```text
BASE-00 + COV-00 -> UX-00
   |
   +-> UX-01 tokens           +-> UX-06 field integrity
   +-> UX-02 theme state      +-> UX-08 reporting correctness
   +-> UX-03 outcome UI (after accepted COH boundary)
                                  |
             UX-04/05/07/09/10 shared renderers
                                  |
              reference COV adoption + scoped IR producers
                                  |
       UX-12 existing serialized contracts release lane
                                  |
                 UX-13A/B -> UX-14
                                  |
           COV all-module adoption -> UX-16 -> UX-17
```

Correctness fixes and static renderer improvements do not wait for every future IR node or the entire AI harness. Conversely, persisted/admin/AI consumers cannot bypass their missing contract or admission gate. The coordinator decides exactly which delivered primitives unblock each slice.

With three workers, useful early parallel work after UX-00 is tokens/CSS, form-field integrity, and stored-report correctness. The coordinator reserves shared exports, module shell, contract models and publication. Do not run UX-06 and UX-07 against the same form files simultaneously.

## 6. Focused worker example: UX-07

```text
Objective: make FormModal submission truthfully reflect the existing operation outcome.
Base: exact accepted integration SHA and COH outcome version.
Allowed: FormModal, ModularForm submission adapter, named test fixtures and one selected caller.
Reserved: business reducers, global contracts, other module clients, theme provider.

Required cases:
- no effective submit binding: disabled/config diagnostic; never Saved;
- config-only binding: invoked exactly once, or explicitly unsupported and diagnosed;
- conflicting bindings: documented deterministic choice or rejection; never duplicate dispatch;
- applied/replay: correct effect reference and approved success behavior;
- validation/rejection: inline diagnostics and values retained;
- waiting: explain prerequisite, do not claim completion;
- outcome unknown: show reconciliation reference, no automatic resend;
- stale save: retain local edits and offer explicit refresh/compare;
- pending/dirty dismissal: accessible and deliberate behavior;
- keyboard submit and focus return work in the actual dialog.

Do not redesign the form engine or return a fake Applied result from Promise<void>.
Return changed callers, tests run/not run, effect/error semantics and remaining blockers.
```

## 7. Acceptance record

Each accepted package records:

```text
ID / owner / reviewer
base + integrated commit
contract/component-catalog versions
module/workflow/caller coverage
canonical owners reused/retired
state/theme/density/viewport combinations actually exercised
action input + canonical readback proof
visual/accessibility/data-semantic results
commands and outputs; skipped checks with reasons
unresolved defects and compatibility-removal tasks
```

A visually attractive screen with a false Saved state, invalid metric, missing relationship navigation or inaccessible action fails. An architecturally tidy config with no usable renderer also fails.

## 8. Effort policy

Do not add a speculative UI-session total to earlier COH/COV estimates. This track replaces/narrows parts of COH-02/05/10, COV-01/25/26/27 and the existing frontend-IR milestones. UX-00 records residual work and dependency/ownership overlap before estimating. Producer, release, consumer, review and live-evidence effort must remain visible; parallel execution does not reduce total work by itself.

## 9. Scope guard

All existing/planned ERP modules stay on the completion matrix. Hidden/disabled is a safety condition, not a U5 pass. Only an explicit product decision may narrow the first-organization exposure target, and that decision must preserve the remaining module backlog. Do not replace exhaustive workflow completion with a polished subset or one golden path for the entire ERP.
