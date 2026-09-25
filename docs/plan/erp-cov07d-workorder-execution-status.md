# COV-07d — exact workorder execution and productivity

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov07d-workorder-execution`  
**Stack base:** COV-07c / `codex/cov07c-production-close`

## Scope

This is the fourth bounded COV-07 Manufacturing slice.

It certifies one exact workorder:

```text
Progress manufacturing order
→ MO-owned workorder + exact workcenter relation
→ warehouse operator Start
→ same workorder = Progress
→ warehouse operator logs one productivity effect
→ same productivity id owned by workorder + workcenter
→ exact duration deltas
→ warehouse operator Finish
→ same workorder = Done
→ productivity relation/duration preserved
```

Quality, scrap/byproducts, routing-depth certification, and full manufacturing
costing remain outside this slice.

## Correctness defects closed

### 1. Workcenter workorder projections were disconnected

`create_workorder` updated `mrp_production.workorder_ids` but did not maintain
the workcenter's existing `order_ids` or state counters.

COV-07d derives the workcenter projection from authoritative
`mrp_workorder.workcenter_id` rows after create/start/finish:

- sorted `order_ids`;
- `workorder_count`;
- Ready count;
- Progress count;
- Pending count.

Cross-scope rows fail the reducer instead of being folded into the projection.

### 2. Start did not prove parent ownership/execution scope

`start_workorder` checked only the workorder row's org/company. It now requires:

- the parent MO exists in the same org/company;
- `mrp_production.workorder_ids` owns the workorder;
- parent MO is Progress or ToClose;
- any blocker workorder is the same-MO/company workorder and is Done.

### 3. Productivity could target a non-running workorder

`log_workcenter_productivity` validated workorder/workcenter relation but not
workorder lifecycle. Productivity is now accepted only while the exact workorder
is Progress under an executing parent MO.

### 4. Productivity was not owned by the workorder

The inserted productivity row was appended to
`mrp_workcenter.productivity_ids`, but `mrp_workorder.time_ids` was never
updated.

COV-07d writes the exact same inserted productivity id to both owners and adds
the submitted duration to both:

```text
workorder.time_ids += productivity.id
workorder.duration += productivity.duration
workcenter.productivity_ids += productivity.id
workcenter.productive_time += productivity.duration
```

### 5. Finish fabricated one unit of duration

`finish_workorder` previously used:

```text
duration = workorder.duration + 1
```

regardless of actual productivity.

Finish now resolves the authoritative productivity rows for the workorder,
requires their ID set to equal `workorder.time_ids`, derives duration from
those rows, sets progress to 100%, and preserves the exact relation.

### 6. Open productivity logs stayed open after workorder completion

Finish now closes any owned productivity log whose `date_end` is still unset.

`complete_productivity_log` also rejects an already-completed log rather than
silently rewriting its completion timestamp on replay.

### 7. Certified UI path required raw workorder entry on a workcenter

The old workcenter form remains available for compatibility, but the COV-07d
operator path no longer asks the user to type a workorder ID.

A Progress workorder row now exposes **Log productivity** directly. Its exact
workcenter ID is supplied from the selected workorder row, while the operator
enters only duration/description.

## Exact application readback

`manufacturing-workorder-execution.ts` owns the COV semantic protocol.

### Start

Readback requires:

- exact workorder id/company;
- exact parent production id;
- parent `workorder_ids` contains the same workorder;
- exact workcenter id;
- workcenter `order_ids` contains the same workorder;
- workorder state = Progress.

### Productivity

Before dispatch, the hook snapshots:

- `workorder.time_ids`;
- workorder duration;
- `workcenter.productivity_ids`;
- workcenter productive time.

After one generated dispatch, completion requires:

- the old sets remain subsets;
- exactly one new workorder time id;
- exactly one new workcenter productivity id;
- those two new IDs are identical;
- workorder duration increases by exactly submitted duration;
- workcenter productive time increases by exactly submitted duration;
- workorder remains Progress under the same parent/workcenter.

This gives canonical productivity identity without needing a separate broad
productivity-list query resource.

### Finish

Before dispatch, the hook snapshots workorder time IDs/duration and workcenter
total/Progress counts.

Completion requires:

- exact same workorder = Done;
- exact parent and workcenter ownership still hold;
- productivity IDs are unchanged;
- derived duration is unchanged;
- progress = 100;
- `is_produced = true`;
- workcenter workorder count is unchanged;
- workcenter Progress count decreases by exactly one.

## Native proof

`test_workorder_execution_exact_effect` proves:

- parent MO owns both created workorders;
- workcenter exact `order_ids` and counters converge;
- productivity against a Pending workorder rejects with no row;
- Start converges exact workorder and workcenter counters;
- stale Start replay rejects;
- exactly one productivity row is created for the exact workorder/workcenter;
- the same productivity ID appears in workorder and workcenter reverse relations;
- workorder duration and workcenter productive time equal the real duration;
- Finish derives duration rather than adding a placeholder;
- Finish closes the productivity log;
- workcenter relations/counters remain exact;
- stale Finish replay rejects without changing the effect.

The test is part of `run_all_manufacturing_tests`.

## Operator/browser proof

`cov07-manufacturing-workorder-execution.spec.ts` uses admin generated
operations for bounded setup only:

```text
create workcenter
→ create/start MO
→ create one exact workorder from the parent relation delta
```

Claimed COV-07d transitions are warehouse-persona UI actions:

1. Start the selected workorder through the Workorders UI;
2. require exact same workorder/parent/workcenter Progress readback;
3. reject stale Start;
4. snapshot both productivity-owner relations;
5. log 2.5 duration through **Log productivity** on the selected workorder;
6. require one identical new productivity ID in both owner relations and exact duration deltas;
7. deny the limited reader from logging another productivity effect;
8. Finish through the same selected workorder UI;
9. require exact Done readback with unchanged productivity relation/duration;
10. stale Finish rejects;
11. limited-reader Finish denies;
12. final workorder remains Done with the exact productivity ID and duration.

## Fixture permission

The warehouse/manufacturing persona now explicitly has:

- `mrp_workcenter:read`;
- `mrp_workcenter_productivity:*`.

The existing `mrp_workorder:*` and `mrp_production:*` grants remain the
execution authorities.

## Acceptance boundary

Implementation is complete, but COV-07d remains **runtime acceptance pending**
until stacked Rust/query-hooks/typecheck/browser execution passes.

COV-07a..d now cover:

```text
MO confirm
→ material consumption
→ production output/finished stock
→ workorder start/productivity/finish
```

This still does not promote all Manufacturing/Quality to U4/U5.

## Next bounded COV-07 slice

**COV-07e — manufacturing quality gate**

Prefer one production/workorder-linked quality check that proves:

```text
exact MO/workorder
→ required quality check
→ pass permits downstream completion
→ fail blocks completion / exposes exact exception
→ stale/replay/deny preserve quality and production effects
```

Keep scrap/byproducts and full costing as later bounded slices.
