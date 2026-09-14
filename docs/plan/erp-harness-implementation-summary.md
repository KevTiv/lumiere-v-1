# ERP harness implementation program summary

This file is a compact navigation layer over the coordinated implementation plan.

Use:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md) for authority, sequencing rules, promotion gates, invariants and coordinator behavior;
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md) for the 73 bounded work packages and dependencies;
- [`erp-harness-implementation-handoff.md`](./erp-harness-implementation-handoff.md) to assign a package to a Luna worker and review its return.

Promotion sequence:

```text
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

Approximate cumulative implementation envelope from the current stack:

```text
P0   ~15–20 Luna sessions
P1   ~35–50
P2   ~50–65
P3   ~60–75
P4/P5 full stated roadmap ~75–95
```

The ledger is dependency-driven, not strictly wave-driven. ERP workflow/invariant work and trusted security-envelope work should proceed in parallel with governed runtime activation when file ownership does not collide.

The architectural plans under `docs/plans` remain semantic authorities. These coordination files exist to prevent implementation agents from turning broad architecture milestones into oversized, overlapping or incompatible changes.