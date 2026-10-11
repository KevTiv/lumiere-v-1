# COV-07m — BOM routing ownership and predecessor execution

Status: implemented; integrated reducer runtime acceptance pending.

Stack base: PR #175, commit `9eb67a11`.

This slice closes the disconnected BOM operation relation. The new
`set_bom_operations` reducer assigns existing operation identities to a scoped
BOM. The server sorts them by `(sequence, id)`, checks active workcenters and
same-organization/company ownership, rejects duplicates, and requires every
dependency to precede its dependent operation in the same BOM. This excludes
cycles and dependencies outside the selected routing. Any manufacturing order
referencing the BOM locks the routing and its quantity basis.

Confirming a routed manufacturing order creates exactly one Pending workorder
per operation in canonical order. These rows carry the MO product/company,
operation workcenter, worksheet, capacity, and server-computed expected duration.
The updated MO ownership survives the confirmation state update. Replaying
confirmation cannot create additional workorders. Callers cannot append manual
rows to routed orders, including before confirmation. Ordinary operation-linked
workorders also reject a mismatched workcenter or duplicate operation.

Expected duration uses the stored manual cycle (or stored automatic cycle),
converted MO quantity in the BOM UOM, BOM batch quantity, workcenter capacity,
and efficiency:

```text
ceil(converted_MO_quantity / BOM_quantity / capacity) × cycle_minutes × 100 / efficiency
```

Non-finite or non-positive duration, capacity, efficiency, and BOM quantity fail
before routing inserts. This is an expected-duration calculation, not a learned
cycle estimator.

Start checks every routing predecessor's exact MO ownership and Done state.
The existing singular `blocked_by_workorder_id` remains a compatibility
projection and cannot bypass a second prerequisite in a fork/join routing.
Workcenter state counters and productivity ownership continue to use existing
authoritative projection helpers.

`spacetimedb/tests/manufacturing/routing_lifecycle_test.rs` adds the persisted
`test_bom_routing_lifecycle` proof. It covers a three-operation fork/join route,
duplicate/missing/foreign/forward/cyclic dependencies, canonical order,
quantity/capacity/efficiency duration (60 minutes per operation), exact
workorder IDs, confirmation replay, caller append rejection, stale BOM changes,
both predecessor gates, time log identities, and final workcenter counts.

Validation performed in this worktree: targeted rustfmt parsed the new Rust
code; `git diff --check` passed. The root integration task owns reducer
registration, generated contract publication, compilation, and executing this
persisted proof. No runtime pass or U5 promotion is claimed here.

Remaining outside this slice: resource-calendar slot reservation, concurrent
capacity scheduling, alternative-workcenter selection, learned automatic cycle
estimation, and browser routing authoring. Manufacturing costing belongs to its
separate COV-07 lane; this slice supplies authoritative operation durations and
time identities for that integration.
