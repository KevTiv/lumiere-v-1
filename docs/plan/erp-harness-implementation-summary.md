# ERP harness implementation program summary

This file is a compact navigation layer over the coordinated implementation plan.

Use:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md) for authority, sequencing rules, promotion gates, invariants and coordinator behavior;
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md) for the broader bounded implementation program;
- [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md) for the mandatory seam-eradication/error-outcome architecture before broad new feature work;
- [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md) for the 13 bounded `COH-*` work packages;
- [`erp-harness-implementation-handoff.md`](./erp-harness-implementation-handoff.md) to assign a package to a Luna worker and review its return.

Current sequencing spine:

```text
BASE accepted implementation + known-defect baseline
  ↓
COH one authority / typed outcomes / seam eradication
  ↓
P0 governed read-only pilot
  ↓
P1 single-agent production harness
  ↓
P2 reusable WorkProgram + sandbox ERP execution
  ↓
P3 organization learning + forensic introspection
  ↓
P4 optional bounded specialists/extensions
  ↓
P5 governed model-refinement plane
```

The `COH` track is mandatory because current code still contains parallel generations of execution, spend, draft correlation, capability implication, policy manifests, resource contracts, scope handling and error semantics. New production capability work should not normalize those seams into permanent architecture.

Approximate planning envelope from the current stack:

```text
COH remediation               ~17–22 focused Luna sessions
P0 after accepted foundation   additional governed-pilot work
P1 cumulative                  previous ~35–50 estimate should be re-baselined after COH
P2/P3/P4/P5                    re-baseline from accepted implementation evidence
```

Do not simply add the COH estimate to the previous roadmap estimate: several COH packages replace/narrow work already counted under GOV/SEC/CAP. `BASE-00` should reclassify delivered/partial/missing work before assigning sessions.

The ledgers are dependency-driven, not strictly wave-driven. ERP workflow/invariant work and trusted security-context work should proceed in parallel with cohesion remediation when file ownership does not collide.

The architectural plans under `docs/plans` remain semantic authorities. These coordination files exist to prevent implementation agents from turning broad architecture milestones into oversized, overlapping or incompatible changes.