# COV-00 correctness and evidence defect register

**Status:** COV-00C ACCEPTANCE CANDIDATE; DOWNSTREAM RUNTIME GATES REMAIN OPEN
**Audited base:** `77f94ef5ea0bd912863acb0a7d12884ad3ad8ecb`
**Purpose:** convert source-level correctness/evidence defects discovered during COV-00 review into explicit owners, closure gates and downstream implementation slices.

Machine-readable ownership and source inventories live in [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json) and are enforced by `python3 scripts/validate-cov00c-correctness-census.py`. See [`erp-cov00c-correctness-census-status.md`](./erp-cov00c-correctness-census-status.md) for the current disposition.

This register is part of COV-00. It does **not** authorize COV-00 workers to repair every runtime defect inside the census PR. COV-00 owns discovery, classification, ownership and acceptance ratchets; COV-01/UX/module owners implement the repairs.

## 1. Defect classes

| ID | Class | Current source evidence | Risk | Owning implementation gate | COV-00 requirement |
| --- | --- | --- | --- | --- | --- |
| `COV-D01` | false success — **resolved/guarded** | `frontend/packages/ui/src/forms/form-modal.tsx` now returns before submit/close/toast when `onSubmit` is absent | regression would let UI claim persisted success without an admitted effect | UX-07 + COV-01 | retain the ordered missing-handler guard; rejected/waiting/unknown adoption continues under `COV-D10` |
| `COV-D02` | heuristic effect correlation | `frontend/packages/query-hooks/src/hooks/ai-action-drafts.ts::resolveLatestDraftId` selects highest pending id by reducer | concurrent/replayed drafts can be associated with the wrong request | COH exact-effect owner + GOV/CAP; COV-01 pattern reused | classify as prohibited latest-row correlation; require stable request/effect identity before acceptance |
| `COV-D03` | ambiguous read state | `fetchQueryListAllowEmpty` / `serverFetchQueryListAllowEmpty` collapse non-OK/failure to `[]` | denied/unavailable/error can render as legitimate empty data | UX shared resource-state work + COV-26 | inventory every critical T0 use; classify whether empty-on-failure is intentional optional behavior or a correctness defect |
| `COV-D04` | degraded form dependency | `RuntimeFormModal` falls back to static config on runtime-config error and can still submit | required relation/visibility/config failure can silently become a different form | UX-07 + COV-22 | classify every form using this fallback; critical forms must expose invalid/degraded state rather than silently proceed |
| `COV-D05` | analytics truthfulness | stored-dashboard domain parser returns all rows on malformed JSON and accepts unknown operators | reports can display plausible but broadened/wrong totals | UX-08 + COV-20 | enumerate admitted report/dashboard bindings and require invalid-definition/error semantics |
| `COV-D06` | analytics completeness | stored-dashboard time filtering retains rows with missing timestamp; missing numeric measure can coerce to zero | period totals/aggregates can silently misstate scope/data completeness | UX-08 + COV-20 | classify metric bindings by time/measure/completeness policy before U4/U5 |
| `COV-D07` | partial-source masking | stored dashboard source hook exposes loading but not source error/partial state to renderer | failed source can appear as an empty dataset/card | UX-08 + COV-20/COV-26 | add source-state evidence requirement for every admitted dashboard/report surface |
| `COV-D08` | test-only operator bypass | HR/Projects/IoT/Proposals and other browser specs perform principal lifecycle transitions through `callReducerBff`/owner helpers | browser test filename/tag can overstate real UI readiness | module COV owner + COV-27 | classify each primary transition as UI-driven, API-only integration, fixture setup or domain-only; U4/U5 requires actual operator transition where user reachability is claimed |
| `COV-D09` | test heuristic identity — **partially resolved** | CRM→Sales now uses exact 0..1 `opportunity_id`; HR/P2P/accounting/manufacturing and legacy helpers still contain latest/highest discovery | duplicates/concurrency can be hidden by test helpers | COV-01 + owning module tests | no certification helper may choose latest/newest for a 0..1 business effect; exact cardinality failure is required |
| `COV-D10` | semantic overclaim — **partially resolved** | CRM reference conversion returns exact semantic convergence; the classified legacy dispatch baseline still commonly resolves transport success/`void` | callers cannot distinguish applied, replay, waiting, rejected or outcome-unknown | COH-02/10 + COV-01 | baseline may only decrease; do not award U4/U5 while effect disposition is unknown |
| `COV-D11` | prototype semantic overclaim — **resolved/guarded** | shared reference helper returns `converged`, not `applied`, after exact readback without domain disposition | regression could encode stronger semantics than evidence supports | COV-01 prototype review | keep observed convergence distinct from authoritative `Applied` unless the server/domain proves disposition |

## 2. Evidence claim model

Every intended T0 lifecycle is evaluated across four independent proof dimensions:

| Dimension | What counts | What does not count |
| --- | --- | --- |
| `D` domain invariant | STDB/domain test proves state transition, rejection, idempotency/invariant | route presence, hook existence |
| `A` API integration | authenticated generated operation path proves current auth/scope/transport | direct domain call without API boundary |
| `O` operator transition | browser performs the actual user action through the product UI | browser test that calls reducer/BFF for the principal transition |
| `E` exact effect/recovery | deterministic result ref/readback, cardinality, replay/lost-response behavior | latest/newest row, name/partner/date/amount heuristic, sleep-only convergence |

Record evidence as `D/A/O/E`, each `proven`, `partial`, `absent`, or `not-applicable` with a reason.

### Promotion rule

For a user-reachable consequential transition, U4/U5 cannot be awarded unless applicable `D`, `A`, `O`, and `E` dimensions are all proven. A strong domain test cannot compensate for absent operator proof; a UI click cannot compensate for ambiguous effect identity.

## 3. Current examples requiring claim correction

### HR / Payroll

Existing browser lifecycle coverage contains useful UI setup/readback but principal leave and payroll transitions use direct BFF calls. Payslip discovery filters by employee and chooses highest id. Treat as `D/A = meaningful`, `O = partial`, `E = partial` until migrated.

### Projects

The current spec explicitly states full SoD validate/bill behavior is covered by domain tests and the browser fixture lacks a second identity. Treat the browser suite as UI/API integration evidence, not operator-complete U4 proof.

### IoT

The lifecycle spec performs hub/device/threshold/telemetry transitions by BFF and only verifies the IoT module renders afterward. Treat as domain/API lifecycle evidence; the operator provision→telemetry→alert→ack/action path remains unproven.

### Proposals

The lifecycle spec explicitly performs proposal setup/status/approval/award/conversion through BFF and checks UI visibility after conversion. It proves backend/API integration, not the complete operator lifecycle.

### CRM → Sales

The operator action now uses strict `opportunity_id` + company 0..1 correlation, rejects duplicate effects, distinguishes `converged` from authoritative `applied`, and proves replay does not redispatch. Direct navigation plus full stale/denied/lost-response UI recovery still belong to COV-01/COV-00D evidence review.

## 4. COV-00 acceptance additions

COV-00 cannot be ACCEPTED until:

1. every discovered defect above has a stable owner and downstream package — satisfied by the COV-00C manifest;
2. every intended T0 module has a `D/A/O/E` evidence row for its primary lifecycle;
3. browser specs that bypass the principal operator transition are not counted as operator proof;
4. latest/newest/heuristic result discovery is explicitly identified and scheduled for removal on certification paths — satisfied for the current named-helper inventory;
5. critical `allow-empty` read paths are classified as correctness debt pending explicit resource-state migration — satisfied for the current callsite inventory;
6. false-success/form-config/report truthfulness defects are attached to UX/COV owners and remain launch blockers where exposed — satisfied;
7. the COV-01 outcome vocabulary is reviewed so observed convergence is not mislabeled as authoritative `Applied` without sufficient evidence — satisfied and guarded.

## 5. Ratchets to add after census classification

The COV-00A/B/C follow-up implementations now enforce the first-org, operation, and correctness ownership inventories. COV-00D/COV-27 must add the evidence-promotion checks that depend on the D/A/O/E matrix:

- no new unclassified user-facing operation;
- no new first-org route without product/COV classification;
- no new certification helper that resolves a 0..1 effect by newest/latest id;
- no primary-lifecycle U5 claim without an operator-path evidence entry;
- no admitted consequential action that maps transport 2xx directly to success without semantic outcome/readback;
- no admitted report/dashboard definition that silently broadens on malformed/unknown filter semantics.

These ratchets should inspect owned metadata/tests rather than grep arbitrary sort calls or forbid legitimate optional empty reads globally.
