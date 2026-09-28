# COV-07b — exact BOM material consumption

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov07b-material-consumption`  
**Stack base:** COV-07a / `codex/cov07a-mo-confirmation`

## Scope

This is the second bounded COV-07 Manufacturing slice.

It certifies:

```text
BOM-backed Confirmed MO
→ warehouse operator Start
→ exact same MO id = Progress
→ warehouse operator Consume materials
→ MO-owned move_raw_ids relation
→ exact BOM-line ↔ stock-move effect set
→ exact component quantity effect
→ idempotent replay
```

Production output, finished-goods moves, work-order execution, quality, scrap,
byproducts, costing, and final close remain outside this slice.

## Correctness defects closed

### 1. Raw move identity was rediscovered by newest id

`consume_mo_materials` called `create_stock_move` and then searched:

```text
production_id == MO
+ product_id == component
→ max_by_key(stock_move.id)
```

That is not canonical effect identity.

`create_stock_move` now delegates to a narrow internal creation owner that
returns the exact inserted `StockMove`. Manufacturing uses that returned row
directly. The public reducer contract remains unchanged.

### 2. Consumed material moves remained Assigned

`done_stock_move` intentionally records `quantity_done` while leaving a move
Assigned for later picking validation. Manufacturing raw moves have no picking
validation step: `consume_mo_materials` applied the quant effect itself, but
left the raw move in Assigned state.

COV-07b explicitly closes each exact raw move as:

```text
state = done
is_done = true
is_assigned = false
```

after recording its done quantity and before completing the MO material effect.

### 3. move_raw_count was not a count

The reducer incremented `move_raw_count` by one regardless of how many BOM
lines produced raw moves. It now stores the actual `move_raw_ids.len()`.

## Exact application readback

`manufacturing-material-consumption.ts` adds COV canonical readback for both
Start and Consume.

Start resolves only when the same company-scoped MO id reads back `Progress`.

Consume resolves only from the MO-owned `move_raw_ids` relation and requires:

- one unique stock-move row for every owned raw-move id;
- `move_raw_count == move_raw_ids.length`;
- one-for-one multiset agreement with the exact BOM lines;
- same company and MO production id;
- exact component product and UOM;
- exact BOM quantity × MO quantity;
- source and destination equal the MO production/source location used by the
  current reducer;
- `quantity_done == product_uom_qty`;
- terminal Done state.

A tempting newer stock move outside `move_raw_ids` can never satisfy readback.

Both hooks use the shared COV dispatch/readback protocol: pre-read for
already-applied, one generated dispatch at most, bounded reconciliation after
ambiguous transport, then focused invalidation.

## Native proof

`test_consume_materials_exact_effect_and_replay` uses a two-line BOM and
requires:

- two unique raw move ids;
- raw count = 2;
- both moves have exact MO/product/UOM/location linkage;
- quantities reflect the two BOM lines at the MO quantity;
- both moves are Done;
- replay keeps exactly the same move ids;
- replay creates no third move;
- replay does not change the component quant again.

The test is part of `run_all_manufacturing_tests`.

## Operator/browser proof

`cov07-manufacturing-materials.spec.ts`:

1. creates deterministic setup BOM + MO data;
2. confirms the MO as setup using the generated operation;
3. signs in as `fixture.warehouse@example.test`;
4. drives **Start** through the Manufacturing row UI;
5. requires exact same-id Progress readback;
6. verifies stale Start rejects before any material effect exists;
7. drives **Consume materials** through the Manufacturing row UI;
8. resolves the effect using the same pure exact resolver as production;
9. requires two exact raw move ids for the two-line BOM;
10. replays Consume and requires the same move ids + unchanged component quantity;
11. denies the limited reader and requires the effect set and quantity remain unchanged.

## Acceptance boundary

Implementation is complete, but this slice remains **runtime acceptance
pending** until the stacked native/query-hooks/typecheck/Playwright lanes run
cleanly.

This does not promote the whole Manufacturing module to U4/U5.

## Next bounded COV-07 slice

**COV-07c — production output → exact finished move → close**

Bound it to:

```text
Progress MO with consumed material
→ record production quantity
→ exact same MO quantity/state readback
→ Finish
→ MO-owned move_finished_ids
→ exact finished stock move + destination quant convergence
→ same MO = Done
→ replay/stale/deny preserve finished effect set
```

Keep work-order scheduling/execution, quality, scrap/byproducts, and full cost
certification separate.
