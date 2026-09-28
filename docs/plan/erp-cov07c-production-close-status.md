# COV-07c — exact production output and manufacturing close

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov07c-production-close`  
**Stack base:** COV-07b / `codex/cov07b-material-consumption`

## Scope

This is the third bounded COV-07 Manufacturing slice.

It certifies:

```text
Progress MO with consumed BOM material
→ warehouse operator records production output
→ exact same MO quantity/state readback
→ MO reaches ToClose only at planned quantity
→ warehouse operator Finish
→ MO-owned move_finished_ids
→ exact terminal finished-goods stock move
→ exact destination-quant increment
→ exact same MO = Done
```

Work-order execution, quality, scrap/byproducts, and full manufacturing-cost
certification remain outside this slice.

## Correctness defects closed

### 1. Production output had no lifecycle guard

`produce_manufacturing_order` previously accepted output from any MO state.
COV-07c restricts output recording to `Progress`.

### 2. Overproduction was accepted

The reducer accumulated arbitrary positive quantities, so produced quantity
could exceed the MO plan.

COV-07c now requires a finite positive quantity no greater than the current
remaining planned quantity. The MO reaches `ToClose` only when
`qty_produced == product_qty`.

### 3. Finish could create full output without recorded production

`finish_manufacturing_order` previously accepted `Progress` and substituted
`product_qty` whenever `qty_produced == 0`.

Finish now requires:

- `state == ToClose`;
- exact produced/planned quantity equality;
- no existing finished-goods relation.

The UI follows the same rule: **Finish** is only presented in `ToClose`.

### 4. Finished move identity used newest-row rediscovery

After creating the finished move, the reducer scanned matching MO/product moves
and selected `max(id)`.

COV-07c uses the internal stock-move creation owner introduced by COV-07b and
keeps the exact returned inserted row identity.

### 5. Finished moves were not terminal

As with the COV-07b raw-material defect, `done_stock_move` records
`quantity_done` for later picking validation and therefore leaves the move
Assigned. Manufacturing finished moves have no picking validation step.

The exact finished move now closes as:

```text
state = done
is_done = true
is_assigned = false
```

before the MO is marked Done.

### 6. Manufacturing quant upsert selected the first matching quant

The Manufacturing-local quant helper used `.find()` for
company/product/location/untracked identity. Duplicate compatible quants could
therefore receive the output arbitrarily.

It now resolves zero-or-one candidate and fails the whole reducer when more
than one canonical quant exists.

### 7. Finish could silently bypass the material effect

For a BOM-backed order with BOM lines but no `move_raw_ids`, Finish previously
deducted component quants directly without creating the COV-07b raw-move
effect.

COV-07c requires BOM materials to have been consumed first and validates every
owned raw move belongs to the same MO/company and is terminal Done.

## Exact application readback

`manufacturing-production-close.ts` owns two semantic mutations.

### Produce

Before dispatch it reads the exact MO and computes:

```text
expected qty = current qty_produced + requested qty
expected state =
  Progress  when expected qty < planned
  ToClose   when expected qty == planned
```

After one generated dispatch, bounded readback must find that exact same MO,
company, quantity, and state.

### Finish

Before dispatch it snapshots the unique untracked destination quant identity
and quantity.

Completion requires:

- same company-scoped MO id = Done;
- `qty_produced == product_qty`;
- exactly one `move_finished_ids` entry and `move_finished_count == 1`;
- that exact move belongs to the MO/company/product/UOM;
- exact source/destination location;
- exact produced and done quantity;
- terminal Done state;
- destination quant is unique;
- a pre-existing destination quant preserves its id;
- destination quantity increases by exactly the produced quantity.

A newer or otherwise matching stock move outside `move_finished_ids` can never
stand in for the canonical finished effect.

## Native proof

`test_production_output_and_finish_exact_effect` proves:

- Draft output is rejected;
- overproduction in Progress is rejected with quantity/state unchanged;
- exact remaining output produces `ToClose`;
- further output after `ToClose` is rejected;
- Finish owns exactly one finished move;
- that move is terminal Done with exact MO/product/location/quantity linkage;
- the existing destination quant id is preserved and increments exactly once;
- direct Finish replay rejects;
- replay preserves both finished move relation and destination quantity.

The test is included in `run_all_manufacturing_tests`.

## Operator/browser proof

`cov07-manufacturing-production-close.spec.ts` uses COV-07a/b operations only
for setup:

```text
create BOM/MO → confirm → start → consume
```

The COV-07c claims themselves are warehouse-operator UI actions:

1. reject an overproduction attempt and preserve Progress/zero output;
2. warehouse persona records the exact remaining quantity through **Record output**;
3. same MO reads back `ToClose` at exact planned quantity with no finished effect yet;
4. stale extra output rejects;
5. snapshot the exact destination quant;
6. warehouse persona runs **Finish** through the Manufacturing row action;
7. the shared exact resolver proves the owned finished move and exact quant delta;
8. direct Finish replay rejects without duplicating move/quant effects;
9. limited reader is denied and the effect set remains unchanged.

## Acceptance boundary

Implementation is complete, but COV-07c remains **runtime acceptance pending**
until the stacked Rust/query-hooks/typecheck/browser lanes execute cleanly.

COV-07a..c now cover the main non-workorder manufacturing spine:

```text
Draft
→ Confirmed
→ Progress
→ exact material consumption
→ exact production quantity
→ ToClose
→ exact finished-goods effect
→ Done
```

This still does not promote full Manufacturing to U4/U5.

## Next bounded COV-07 slice

**COV-07d — work-order execution**

Bound it to one exact work order:

```text
MO/routing operation
→ exact workorder relation
→ Start
→ productivity/workcenter effect
→ Finish
→ same workorder Done
→ parent MO workorder_ids + state visibility
→ stale/replay/deny preservation
```

Keep quality, scrap/byproducts, and costing separate.
