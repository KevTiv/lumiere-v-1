# ERP harness implementation program summary

This file is a compact navigation layer over the coordinated implementation plan.

Use:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md) for authority, sequencing rules, promotion gates, invariants and coordinator behavior;
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md) for the broader bounded implementation program;
- [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md) for the mandatory seam-eradication/error-outcome architecture before broad new feature work;
- [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md) for the 13 bounded `COH-*` work packages;
- [`../plans/erp-module-usability-parity-program.md`](../plans/erp-module-usability-parity-program.md) for the semantic definition of equal module-completeness and **T0 first-test-organization ERP readiness**;
- [`erp-module-usability-parity-ledger.md`](./erp-module-usability-parity-ledger.md) for bounded `COV-*` module-completion packages;
- [`../plans/erp-ui-design-system-completion-plan.md`](../plans/erp-ui-design-system-completion-plan.md) for shared UI interaction, charts/forms/reports, theming and presentation-IR requirements;
- [`erp-ui-completion-ledger.md`](./erp-ui-completion-ledger.md) for bounded `UX-*` shared implementation and proof packages;
- [`erp-harness-implementation-handoff.md`](./erp-harness-implementation-handoff.md) to assign a package to a Luna worker and review its return.

Current sequencing is intentionally two-dimensional after the accepted BASE/COH foundation:

```text
BASE accepted implementation + known-defect baseline
  ↓
COH one authority / typed outcomes / seam eradication
  ├──────────────────────────────────────────┐
  ↓                                          ↓
ERP-COV module/workflow parity               GOV governed AI runtime
  + shared UX components/config/IR adoption   ↓
  ↓                                          P0 governed read-only AI pilot
T0 first-test-org ERP ready                   ↓
                                             P1 single-agent production harness

T0 + certified ERP workflows feed later CAP / WPR / offline consequential use.
P1 then continues to P2 WorkPrograms/sandbox → P3 learning/forensics → optional P4 → P5.
```

## T0 — first-test-organization ERP readiness

T0 is a product gate independent of AI. Every module/surface exposed to the first test organization must reach the common **U5 first-test-org certified** class. A smaller module may have fewer workflows than Accounting, but it does not get a lower quality bar.

The parity contract includes:

```text
discovery/navigation
real read/search/detail surfaces
core record operations
complete primary lifecycle
cross-module record links
server authorization/company scope
approval/stale/retry/idempotency semantics
COH typed outcomes/errors
audit/activity/documents/messages where applicable
meaningful loading/empty/error/denied states
truthful metric scope/units/freshness/completeness
accessible, theme-consistent shared controls
responsive/mobile usability
persisted golden-path + adversarial E2E proof
```

A non-U5 module is hidden/disabled for safe exposure. No visible stub page, dead quick action, empty promised tab, fake local success, or unclassified user-facing operation is accepted at T0. **Hiding is containment, not completion:** all existing/planned module families stay on the coverage matrix. Workers cannot narrow the first-org target without an explicit product decision.

`COV-00` must re-audit the current tree before implementation. Historical frontend/reducer plans are discovery inputs only; many surfaces have changed since they were written.

## Shared UI completion

The design references have distinct roles: Odoo for ERP workflow structure, Vercel/Apple for restrained presentation and interaction, PostHog for analytical exploration and an optional Warm visual preset. Official source references and explicit limitations are recorded in the UI plan. Their reputation is not a substitute for first-org usability proof.

Keep the current ModuleView, entity views, shared form system, dashboard renderers, Recharts and token/theme owners. Correct false Saved states, lossy field adapters and misleading report/filter behavior before polishing them. Extend the existing Rust-owned presentation model and approved dictionary; do not create another JSON renderer or persist React callbacks/components as configuration.

`UX-00` first reconciles the planning branch with the separately delivered presentation-IR/save-reopen/contracts stack. Shared UI tasks feed COV module adoption; they do not reimplement COV workflows. Static UI correctness improvements need not wait for every future IR node or AI milestone. Persisted/admin/AI definitions must still pass the existing contract, preview and admission boundaries.

Three reference workspaces establish adoption patterns: order/invoice, inventory/manufacturing, and reporting/admin composition. All other COV module families then adopt applicable patterns and record actual renderer, accessibility, data-state and canonical outcome evidence. Source inspection is not visual certification.

## Planning envelope

```text
COH remediation                    ~17–22 focused Luna sessions before overlap
ERP-COV exhaustive module parity   provisional ~30–45, re-baseline at COV-00
UX shared completion               residual scope estimated at UX-00; overlaps COV/COH/IR
P0/P1 harness work                 re-baseline from accepted COH/GOV evidence
P2/P3/P4/P5                        re-baseline from accepted implementation evidence
```

Do not simply add these ranges together. COH replaces/narrows work previously counted under GOV/SEC/CAP; COV will discover already-implemented ERP functionality; UX replaces/narrows existing shared UI and presentation-IR work. `BASE-00`, `COV-00` and `UX-00` own evidence-based reclassification before worker assignment. Parallel execution does not by itself reduce total effort.

The ledgers are dependency-driven, not strict serial waves. Module-completion lanes should run in parallel with governed-AI work when ownership is disjoint, while contract/codegen releases and shared ERP workflow/result infrastructure remain serialized through the coordinator.

The architectural plans under `docs/plans` remain semantic authorities. These coordination files exist to prevent implementation agents from turning broad architecture milestones into oversized, overlapping or incompatible changes.
