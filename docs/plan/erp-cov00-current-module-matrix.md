# COV-00 current module and operation census

**Status:** ACCEPTED — coordinator-reviewed audit/classification baseline; downstream runtime blockers remain
**Program:** [`erp-module-usability-parity-ledger.md`](./erp-module-usability-parity-ledger.md)  
**Semantic authority:** [`../plans/erp-module-usability-parity-program.md`](../plans/erp-module-usability-parity-program.md)  
**Audited base:** `afa23b702fc4c47623697d2fcb81733f2dd71c14` (`main`, 2026-09-17 audit)  
**Accepted evidence revision:** `4f797db650ae82318ab0f477670d14aee9d5d0cd`
**Contracts baseline:** `lumiere-contracts` v0.3.46  

## 1. Method and limits

This is the COV-00 source/evidence census required before broad T0 module work. It reconciles the current module route tree, SpacetimeDB domain breadth, frontend command/query surfaces, reducer coverage artifact, existing browser/domain evidence, and the accepted BASE state.

The audit deliberately does **not** infer U4/U5 from route existence, reducer count, a CRUD form, or a historical plan. Existing tests are treated according to what they actually prove. In particular, browser specs that drive lifecycle transitions through direct BFF/reducer helpers prove backend/transport behavior but do not by themselves prove a complete operator UI lifecycle.

No new seeded stack, browser suite, accessibility pass, or human usability session was executed in this documentation PR. Existing integrated evidence remains authoritative where cited by the BASE program.

## 2. Executive finding

Lumière's T0 gap is no longer mainly backend breadth. The repository already contains broad STDB domains, named command surfaces, query hooks, concrete module routes, and substantial E2E/domain coverage. The dominant remaining work is **product convergence from U2/U3 toward U4/U5**:

- one common outcome/error/readback contract;
- complete operator-reachable lifecycles instead of test-only BFF transitions;
- deterministic cross-module result links;
- explicit retry/stale/idempotency/outcome-unknown behavior;
- current authorization and separation-of-duties proof;
- first-test-org exposure control;
- shared seed/persona fixtures;
- full-stack adversarial, responsive and accessibility certification.

No audited T0 surface can be called U4 or U5 yet under the parity definition.

> **COV-00D acceptance candidate (base `ed4987d3d99a89c2a3f2a7cddc8ca212548b1831`):** the per-owner lifecycle calibration is recorded in [`erp-cov00d-evidence-calibration-status.md`](./erp-cov00d-evidence-calibration-status.md) with machine-readable evidence in [`../evidence/cov-00d-lifecycle-evidence.json`](../evidence/cov-00d-lifecycle-evidence.json). All 22 COV-03..24 owners are covered; only one principal operator dimension is currently proven and no exact-effect/recovery dimension is complete, so every first-org surface remains at `review`.

## 3. Current surface census

The current `frontend/web/app/(modules)` tree exposes 31 top-level route families:

```text
accounting             ai-action-drafts       ai-harness
ai-skills              approvals              calendar
crm                    distributor            documents
expenses               forensics              helpdesk
hr                     inventory              iot
manufacturing          map                    messages
overview               pos                    presentation-preview
projects               proposals              purchasing
reports                sales                  settings
subscriptions          tasks                  trackers
workflows
```

Classification for T0 planning:

| Route / surface | COV owner | Classification | T0 disposition |
| --- | --- | --- | --- |
| `/crm` | COV-03 | T0 business module | certify or hide |
| `/sales` | COV-04 | T0 business module | certify or hide |
| `/purchasing` | COV-05 | T0 business module | certify or hide |
| `/inventory` | COV-06 | T0 business module | certify or hide |
| `/manufacturing` | COV-07 | T0 business module | certify or hide |
| `/accounting` | COV-08 | T0 business module | certify or hide |
| `/hr` | COV-09 | T0 business module | certify or hide |
| `/projects`, `/tasks` | COV-10 | T0 business module + shared task surface | certify together or hide incomplete task affordances |
| `/expenses` | COV-11 | T0 business module | certify or hide |
| `/subscriptions` | COV-12 | T0 business module | certify or hide |
| `/pos` | COV-13 | T0 business module | certify or hide |
| `/helpdesk` | COV-14 | T0 business module | certify or hide |
| `/map` + Fleet domain | COV-15 | T0 business/operational workspace | choose one canonical Fleet entry and certify it |
| `/iot` | COV-16 | T0 business module | certify or hide |
| `/proposals` | COV-17 | T0 business module | certify or hide |
| `/documents` | COV-18 | T0 horizontal capability | certify or hide incomplete lifecycle actions |
| `/calendar`, `/messages` | COV-19 | T0 horizontal capability | certify; BASE-03 blocks U4/U5 communications |
| `/reports` | COV-20 | T0 horizontal capability | certify or hide unsupported report modes |
| `/approvals`, `/workflows` | COV-21 | T0 horizontal/control capability | certify or hide unsupported automation modes |
| import/data-ops/forms/templates (embedded surfaces) | COV-22 | T0 horizontal/admin capability | classify every entry point; no standalone route required |
| `/settings` | COV-23 | administrative, required for test-org admin | certify intended admin paths; hide internal settings |
| `/distributor` | COV-24 | T0 vertical workspace | expose only if selected for first org |
| `/overview` | COV-25/26 integration | T0 shell/dashboard | must only link to admitted surfaces |
| `/ai-action-drafts`, `/ai-harness`, `/ai-skills` | GOV/CAP, not COV | AI | P0/P1 governed; not required for T0 |
| `/presentation-preview` | frontend-IR/UX | internal/admin preview | hide from ordinary first-org users unless explicitly admitted |
| `/forensics` | INTRO/admin | internal/admin | not a T0 business module; hide unless separately admitted |
| `/trackers` | product decision required | internal/showcase candidate | hide until owner/use-case and U-level are explicit |

### Fleet mismatch

Fleet is the clearest route/domain mismatch. STDB Fleet, frontend command/read/query surfaces and domain tests exist, but there is no dedicated `/fleet` module. Current operational UI is under `/map`. COV-15 must make an explicit product decision: either `/map` is the canonical Fleet/field-assets workspace and is certified as such, or a dedicated Fleet route is added. T0 must not expose two partial authorities.

## 4. Operation inventory finding

> **COV-00A acceptance candidate (base `b4e23eff69a5a1cba62e07ca9866bb5eb649c9d2`):** the refreshed full-contract census is recorded in [`../operation-classification-census.md`](../operation-classification-census.md) with machine-readable evidence in [`../evidence/cov-00a-operation-census.json`](../evidence/cov-00a-operation-census.json). It classifies 1,399 operations, reconciles 1,187 Rust reducer rows, and reports zero unowned client-facing or review-required rows. The historical finding below is retained to explain why the full-contract ratchet replaced the reducer-only denominator.

The generated `docs/reducer-coverage-matrix.md` currently records:

| Reducer coverage state | Count |
| --- | ---: |
| `api-only-intentional` | 11 |
| `backend-only` | 89 |
| `command-only` | 945 |
| `internal-intentional` | 18 |
| `needs-triage` | 25 |
| `reachable-ui` | 23 |
| **total reducer rows** | **1,111** |

Classification in that artifact is:

| Classification | Count |
| --- | ---: |
| user-facing | 972 |
| admin | 53 |
| import | 60 |
| internal/background | 19 |
| dev-only | 7 |

This is useful evidence, but it was generated on 2026-09-04 and is not the accepted current operation authority. The current v0.3.46 application IR validated by BASE contains **1,329 operations, 336 resources and 471 tables**. COV-00 therefore cannot claim that every current operation has been classified from the older 1,111-row reducer artifact.

Also, `command-only` is **not** synonymous with "missing UI". A healthy ERP should compose many low-level operations behind a smaller number of workflow actions. COV uses the following T0 operation disposition instead:

```text
primary-workflow     required by the module's principal user journey
secondary-advanced   deliberately reachable from an advanced/admin surface
horizontal           owned by Documents/Messages/Approvals/Imports/etc.
internal-support     implementation/orchestration/background; not directly user-invoked
future-disabled      valid capability deliberately not exposed to first org
obsolete/duplicate   remove or redirect to canonical owner
```

### COV-00 operation closure requirement

Before COV-00 becomes ACCEPTED:

1. regenerate the reducer/operation coverage artifact from the accepted current contracts/main revision;
2. reconcile the regenerated set with all 1,329 application-IR operations rather than silently dropping non-reducer operations;
3. eliminate every `needs-triage` operation;
4. assign every user-facing/admin/import operation to a COV owner and one disposition above;
5. treat `uncategorized` module ownership as a census defect, not a valid long-term owner;
6. add a ratchet so a newly introduced user-facing operation cannot remain unclassified.

The important outcome is not 972 buttons. It is that every operation is either intentionally reachable through a certified workflow/surface or intentionally not exposed.

## 5. Current U-level evidence floors

These are **source/evidence floors, not certification awards**. `U3` below means there is credible evidence for a primary lifecycle; it does not imply the U4/U5 gates are met. `U2` may include deeper domain behavior where the browser/operator path remains incomplete.

| COV | Surface | Current evidence floor | Existing evidence | Main gap to next class |
| --- | --- | --- | --- | --- |
| COV-03 | CRM | **U3** | concrete CRM route/forms; lead/opportunity mutations; contact identity UI; lead-to-cash and CRM isolation/stage specs | direct downstream record navigation; shared outcome semantics; stale/retry/adversarial consolidation |
| COV-04 | Sales | **U3** | quote/order/invoice/returns domain + UI; lead-to-cash, invoice-flow, returns specs | U4 retry/lost-response/concurrency + canonical downstream links; downstream payment blocker |
| COV-05 | Purchasing | **U3** | supplier/PO/receipt/bill surfaces; P2P + purchasing specs | stale approval/reference mutation/adversarial certification and direct result links |
| COV-06 | Inventory / WMS | **U2** | product/location/stock command/query/UI breadth; inventory module/mutation specs; fulfillment participates in O2C | one operator-complete receiving/transfer/count/lot lifecycle + concurrency/stale-stock proof |
| COV-07 | Manufacturing / Quality | **U2** | MRP domain, module route, mutation and manufacturing smoke coverage | seeded BOM → MO → consume → produce → quality/cost/close browser lifecycle |
| COV-08 | Accounting / Finance / Assets | **U3** | journal/invoice/payment/reconcile/close/assets breadth; accounting/reconciliation/payment specs | BASE-04 payment/import semantics; PAY-06 overpayment defect; U4 money/idempotency/lost-response certification |
| COV-09 | HR / Payroll | **U2** | broad UI/domain; leave and payroll lifecycle specs | browser lifecycle still uses direct BFF transitions for key states; SoD/persona fixture + sensitive-data/stale/retry proof |
| COV-10 | Projects / Tasks | **U2** | Projects and Tasks routes; project/timesheet lifecycle spec; domain SoD coverage | operator-reachable create→time→validate→bill path and canonical Sales/Accounting handoff |
| COV-11 | Expenses | **U2** | capture/ops UI and lifecycle coverage; domain SoD proof | full create→submit→approve→post→reimburse browser path with second persona and duplicate protection |
| COV-12 | Subscriptions | **U2** | module + command breadth; subscription smoke/domain lifecycle | browser activate→bill→payment→amend/renew/cancel/dunning path; retry/double-bill proof |
| COV-13 | POS | **U2** | POS route/config/domain surfaces and cross-domain stock/accounting primitives | seeded session→order→payment→close/reconcile lifecycle + duplicate/reconnect proof |
| COV-14 | Helpdesk | **U2** | ticket/team UI and mutation coverage | complete intake→assign/SLA→resolve→close/reopen browser lifecycle + tenant/stale/notification proof |
| COV-15 | Fleet / Map | **U1** | Fleet STDB/read/commands/hooks; `/map` creates/positions vehicles | canonical route/ownership decision; service/fuel/inspection/cost lifecycle and finance/employee links |
| COV-16 | IoT | **U2** | IoT route/tabs, lifecycle and read-isolation specs | complete provision→telemetry→alert→ack/action browser flow + degraded dependency/stale alert proof |
| COV-17 | Proposals | **U3** | proposal create/workspace + lifecycle spec; lines/source docs/review semantics | stale review/auth/approval and canonical conversion/handoff proof |
| COV-18 | Documents / Knowledge | **U2** | document domain/UI + Wave A lifecycle; Wave B surfaces | full version/recycle/retention/legal-hold/blob lifecycle through real UI; company-scope/storage hardening |
| COV-19 | Calendar + Messages / Communications | **U2** | calendar/messages routes, operational messaging, chatter coverage | BASE-03 consent/identity/SOD/provider-callback defects + record timeline integration |
| COV-20 | Reports / Analytics | **U3** | analytics lifecycle, report UI, owner-report catalogue/export evidence | truthful filter/completeness semantics, schedule/export provenance, drill-through and shared UX proof |
| COV-21 | Approvals / Workflows | **U2** | approval inbox/workflow route + gate UI/parity specs | current-auth/SOD/stale approval/timer replay/full failure-state lifecycle |
| COV-22 | Imports / Data Ops + Forms / Templates | **U2** | broad import pipeline, rollback, form-config/settings surfaces | one admitted end-to-end import with malformed/retry/idempotency proof; explicit form/template exposure map |
| COV-23 | Org / Company / Settings / Auth | **U3** | settings/admin surface; auth lifecycle and permission enforcement coverage | first-org bootstrap/persona pack, revoked membership/company switch/recovery + hidden internal settings manifest |
| COV-24 | Distributor workspace | **U2** | dedicated route/workspace and vertical-distributor spec | complete order→delivery→collection/partial-payment→stock-exception daily loop |

### U4/U5 blockers common to all rows

No row is promoted to U4/U5 by this audit because the following shared gates remain open:

- COV-01 common operation outcome/error/record-ref/readback seam depends on COH-02;
- COV-02 now supplies the accepted reproducible first-test-org seed/persona authority; module-specific permission, SoD, lifecycle, and recovery proof remains open;
- COV-25 cross-module relation/navigation consistency has not been audited/closed;
- COV-26 common loading/empty/error/denied/responsive/accessibility/reconnect proof has not run;
- COV-27 all-module integrated certification/launch manifest has not run;
- BASE-03 communication defects remain blockers for affected surfaces;
- BASE-04 payment/import/recovery defects remain blockers for affected surfaces;
- BASE-05 integrated pre-tenant evidence still contains known unfinished certification/defect classes.

## 6. Test evidence taxonomy

Current tests are extensive, but COV must stop counting all browser files as equivalent proof.

### Strong vertical evidence already worth reusing

- `mvp-lead-to-cash.spec.ts`
- `mvp-sales-returns.spec.ts`
- `mvp-invoice-correction.spec.ts`
- `mvp-procure-to-pay.spec.ts`
- `accounting-post-reconcile.spec.ts`
- `bank-statement-import.spec.ts`
- `crm-read-isolation.spec.ts`
- `iot-read-isolation.spec.ts`
- pre-tenant payment/communications/mobile adversarial suites

### Browser files that are useful but not U5 lifecycle proof by themselves

Examples include module/mutation/smoke specs, route-presence checks, and lifecycle files that perform principal transitions through `callReducerBff`/owner helpers. These remain valuable integration evidence but must be supplemented by the actual operator path where COV requires user reachability.

Two concrete examples from the current tree:

- `documents-wave-b-lifecycle.spec.ts` currently proves that `/documents` renders; its comment explicitly delegates full lifecycle proof to a domain reducer test.
- `subscriptions-wave-lifecycle.spec.ts` proves tabs/action presence while its comment delegates the full subscription lifecycle to the domain suite.

COV owners should extend existing files rather than create parallel certification frameworks.

## 7. Exposure / launch-manifest finding

No current first-test-org launch/exposure manifest was found that serves as the authoritative denominator for T0. The route tree includes AI, forensics, presentation preview, trackers and other surfaces that are not automatically T0 product modules. Historical cleanup work also calls for auditing showcase-only sidebar/command-palette destinations.

COV therefore needs an explicit launch manifest (or equivalent single configuration owner) that can answer for every route/navigation entry:

```text
enabled for first org?
required role/capability?
COV/admin/AI/internal classification?
minimum accepted U-level/evidence revision?
hidden reason if disabled?
```

Hiding an unfinished module is valid containment for T0 exposure, but does not remove it from the backlog.

## 8. Revised execution priorities

The census changes the implementation order from broad greenfield module work to targeted convergence.

### Immediate shared work

1. **COV-00A — operation census refresh and disposition**  
   Regenerate against current IR/contracts; reconcile all 1,329 operations; resolve `needs-triage` and `uncategorized`; add a classification ratchet.
2. **COV-00B — exposure manifest/navigation census**  
   Create the first-org route/navigation denominator and explicitly classify AI/internal/showcase surfaces; settle Fleet `/map` ownership.
3. **COV-01 — typed workflow result/readback boundary** after COH-02.  
   Migrate one representative lifecycle and reuse it everywhere.
4. **COV-02 — shared seed/persona pack (`ACCEPTED`).**
   Reuse the versioned seven-persona/22-owner foundation and its required IoT baseline; do not count it as module lifecycle evidence.

### First module lanes after the shared boundary

- **Lane A:** CRM → Sales, because O2C already has the strongest vertical evidence; focus on U4/U5 gaps, not reimplementation.
- **Lane B:** Purchasing → Inventory → Manufacturing; P2P is mature, WMS/MRP need stronger operator lifecycle proof.
- **Lane C:** Accounting first, then Expenses/Subscriptions/POS; payment correctness is the blocking spine.
- **Lane D:** HR/Projects/Helpdesk/Fleet/IoT; convert domain/BFF lifecycle evidence into complete operator paths and shared persona tests.
- **Lane E:** Documents/Calendar/Messages/Reports/Approvals/Imports/Settings; close shared horizontal semantics before every module invents local variants.

## 9. Re-baselined planning envelope

This census does not justify reducing the denominator to the old V1 wedge. It also shows that many planned module packages are not greenfield builds.

A reasonable remaining planning envelope **after this COV-00 audit** is:

```text
COV-00A/B classification + exposure closure     ~2–3 focused sessions
COV-01/02 shared workflow + seed foundation     ~3–4
COV-03..17 business-module convergence          ~18–25
COV-18..24 horizontal/admin/vertical convergence ~7–10
COV-25..27 integration/UX/certification          ~6–8

remaining COV program                            ~36–50 focused sessions
```

These are work-package weights, not elapsed-time estimates. The upper bound applies if operation triage reveals significant genuinely user-facing capability that is currently only command-backed. The lower bound assumes most command-only operations are correctly composed, advanced, internal-support or deliberately disabled rather than requiring one-to-one screens.

## 10. COV-00 disposition

### Delivered by this audit

- current route/product surface census;
- T0/admin/AI/internal classification for the visible route families;
- current evidence-floor U-level for every COV-03..24 owner;
- exact shared blockers preventing U4/U5 claims;
- resolved Fleet/Map product ownership decision;
- operation-coverage drift finding;
- test-evidence quality distinction;
- authoritative first-org exposure denominator;
- revised execution ordering and evidence-based planning envelope.

### Acceptance result

- COV-00A through COV-00D were coordinator-reviewed and accepted at evidence revision `4f797db650ae82318ab0f477670d14aee9d5d0cd`;
- the nine open/partial COV-00C runtime classes remain blockers only for their named downstream U4/U5 and COV-27 gates;
- every COV-owned first-org surface remains `review` until its own acceptance package supplies complete applicable evidence.

The accepted coordinator record is [`erp-cov00-coordinator-acceptance.md`](./erp-cov00-coordinator-acceptance.md). Dependent module work must reuse the accepted operation classifications and exposure policy rather than redefining them locally.
