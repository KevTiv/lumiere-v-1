# ERP harness implementation program summary

This file is a compact navigation layer over the coordinated implementation plan.

Use:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md) for authority, sequencing rules, promotion gates, invariants and coordinator behavior;
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md) for the broader bounded implementation program;
- [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md) for the mandatory seam-eradication/error-outcome architecture before broad new feature work;
- [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md) for the 13 bounded `COH-*` work packages;
- [`../plans/erp-module-usability-parity-program.md`](../plans/erp-module-usability-parity-program.md) for the semantic definition of equal module-completeness and **T0 first-test-organization ERP readiness**;
- [`erp-module-usability-parity-ledger.md`](./erp-module-usability-parity-ledger.md) for bounded `COV-*` module-completion packages;
- [`erp-harness-implementation-handoff.md`](./erp-harness-implementation-handoff.md) to assign a package to a Luna worker and review its return.

Current sequencing is intentionally two-dimensional after the accepted BASE/COH foundation:

```text
BASE accepted implementation + known-defect baseline
  ↓
COH one authority / typed outcomes / seam eradication
  ├──────────────────────────────┐
  ↓                              ↓
ERP-COV module/workflow parity   GOV governed AI runtime
  ↓                              ↓
T0 first-test-org ERP ready      P0 governed read-only AI pilot
                                 ↓
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
responsive/mobile usability
persisted golden-path + adversarial E2E proof
```

A non-U5 module is hidden/disabled for the test organization. No visible stub page, dead quick action, empty promised tab, fake local success, or unclassified user-facing operation is accepted at T0.

`COV-00` must re-audit the current tree before implementation. Historical frontend/reducer plans are discovery inputs only; many surfaces have changed since they were written.

## Planning envelope

```text
COH remediation                    ~17–22 focused Luna sessions before overlap
ERP-COV exhaustive module parity   provisional ~30–45, re-baseline at COV-00
P0/P1 harness work                 re-baseline from accepted COH/GOV evidence
P2/P3/P4/P5                        re-baseline from accepted implementation evidence
```

Do not simply add these ranges together. COH replaces/narrows work previously counted under GOV/SEC/CAP, and COV will discover substantial already-implemented ERP functionality. `BASE-00` and `COV-00` own evidence-based reclassification before worker assignment.

The ledgers are dependency-driven, not strict serial waves. Module-completion lanes should run in parallel with governed-AI work when ownership is disjoint, while contract/codegen releases and shared ERP workflow/result infrastructure remain serialized through the coordinator.

The architectural plans under `docs/plans` remain semantic authorities. These coordination files exist to prevent implementation agents from turning broad architecture milestones into oversized, overlapping or incompatible changes.