# COV-00 correctness and evidence defect register

**Status:** COV-00C ACCEPTANCE CANDIDATE; DOWNSTREAM RUNTIME GATES REMAIN OPEN
**Audited base:** `f6071f67a17e9973ff7bbd95cf26510aa5d80d32`
**Purpose:** convert source-level correctness/evidence defects discovered during COV-00 review into explicit owners, closure gates and downstream implementation slices.

Machine-readable ownership and source inventories live in [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json) and are enforced by `python3 scripts/validate-cov00c-correctness-census.py`. See [`erp-cov00c-correctness-census-status.md`](./erp-cov00c-correctness-census-status.md) for the current disposition.

This register is part of COV-00. It does **not** authorize COV-00 workers to repair every runtime defect inside the census PR. COV-00 owns discovery, classification, ownership and acceptance ratchets; COV-01/UX/module owners implement the repairs.

## 1. Defect classes

| ID | Class | Current source evidence | Risk | Owning implementation gate | COV-00 requirement |
| --- | --- | --- | --- | --- | --- |
| `COV-D01` | false success — **resolved/guarded** | `frontend/packages/ui/src/forms/form-modal.tsx` now returns before submit/close/toast when `onSubmit` is absent | regression would let UI claim persisted success without an admitted effect | UX-07 + COV-01 | retain the ordered missing-handler guard; rejected/waiting/unknown adoption continues under `COV-D10` |
| `COV-D02` | heuristic effect correlation — **resolved/guarded** | gateway, governed red-action bridge and tool drafts now persist through `create_ai_run_action_draft` and read exact `ai_action_draft_request` mappings | regression could associate concurrent/replayed drafts with the wrong request | COH exact-effect owner + GOV/CAP; COV-01 pattern reused | retain durable `(organization, company, run, request_key)` identity and 0..1 readback; zero-run and latest-row fallbacks stay forbidden |
| `COV-D03` | ambiguous read state — **resolved/guarded** | critical API/SSR reads now return `ready`, `empty`, `denied`, or `unavailable`; all T0 SSR batches require a successful resource state | regression could render denied/unavailable data as empty | UX shared resource-state work + COV-26 | retain typed critical reads; allow-empty compatibility is permitted only for optional seeds or fail-closed membership checks |
| `COV-D04` | degraded form dependency — **resolved/guarded** | `RuntimeFormModal` blocks submission and shows an alert when runtime configuration fails; no production caller opts into static fallback | regression could silently submit a different form | UX-07 + COV-22 | retain fail-closed default; any `use-static` caller requires an explicit degraded-safe classification |
| `COV-D05` | analytics truthfulness — **resolved/guarded** | stored-dashboard resolution rejects malformed definitions, unknown operators, invalid sorts, aggregations and chart types | regression could broaden a report while presenting plausible totals | UX-08 + COV-20 | invalid definitions must stay visible and must block export |
| `COV-D06` | analytics completeness — **resolved/guarded** | bounded periods exclude missing timestamps; numeric aggregations exclude missing measures and report partial completeness | regression could silently misstate scope or totals | UX-08 + COV-20 | incomplete rows must remain explicit and must block export |
| `COV-D07` | partial-source masking — **resolved/guarded** | per-source loading/ready/empty/denied/unavailable/partial state reaches the renderer, query builder and export gate | regression could present a failed source as empty | UX-08 + COV-20/COV-26 | retain per-source state through rendering and export |
| `COV-D08` | test-only operator bypass — **resolved/guarded** | COV-00D classifies every module operator mode and every O item role; its validator forbids API-driven evidence from proving a UI-primary transition | regression could overstate operator readiness | module COV owner + COV-27 | keep U4/U5 and admitted surfaces gated on complete D/A/O/E plus principal operator evidence |
| `COV-D09` | test heuristic identity — **resolved/guarded** | certification helpers now use producer-owned relations or unique request fields and fail when exact cardinality exceeds one | regression could hide duplicates or concurrent effects | COV-01 + owning module tests | no certification helper may select latest/newest for a 0..1 business effect |
| `COV-D10` | semantic overclaim — **partially resolved** | CRM conversion and account-move posting return exact semantic convergence; 864 legacy generated dispatch sites remain classified under a 865-site ratchet ceiling | unmigrated callers cannot distinguish applied, replay, waiting, rejected or outcome-unknown | COH-02/10 + COV-01 + module owners | baseline may only decrease; do not award U4/U5 while effect disposition is unknown |
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

Existing browser lifecycle coverage contains useful UI setup/readback but principal leave and payroll transitions use direct BFF calls. Payslip discovery now uses a run-unique note and exact 0..1 cardinality. Treat `O` as partial and keep `E` partial until retry and lost-response proof exists.

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
4. latest/newest/heuristic result discovery is removed from the current certification effect paths and guarded by the owned inventory;
5. critical T0 reads use explicit resource states; the remaining allow-empty compatibility paths are optional seeds or fail closed;
6. false-success, form-config and report-truthfulness defects have source guards and focused tests;
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
