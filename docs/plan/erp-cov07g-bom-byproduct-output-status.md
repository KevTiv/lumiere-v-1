# COV-07g — exact BOM byproduct output

**Status:** REVIEW — bounded historical browser acceptance passed; full module acceptance open
**Branch:** `codex/cov07g-bom-byproduct-output`  
**Stack base:** COV-07f / `codex/cov07f-finished-output-scrap`

## Bounded path

`mrp_bom.byproduct_ids` now owns real `mrp_bom_byproduct` rows. The
`create_bom_byproduct` reducer validates the BOM scope, product and compatible
UOM, positive quantity, unique product, and aggregate cost share at or below
100%. It appends the exact inserted ID to the BOM projection. BOM deletion also
removes its owned byproduct rows when no MO references the BOM.

When a BOM-backed MO finishes, the reducer compares authoritative byproduct
rows with `bom.byproduct_ids` before creating any output. Each untracked
byproduct quantity is scaled by `mo.product_qty / bom.product_qty`, then written
as one Done `stock_move` owned by the MO and one exact destination quant delta.
The primary and byproduct move IDs are all recorded in
`mrp_production.move_finished_ids` and its count.

The persisted domain test covers exact BOM ownership, duplicate definition
rejection, one primary plus one byproduct output move, cost-share propagation,
and the exact byproduct quant quantity. COV-07f primary-output scrap now selects
the exact primary product move from the expanded finished-move relation.

## Limits and remaining certification

- This slice supports untracked byproducts. Lot/serial byproducts need explicit
  produced-lot attribution.
- Cost share is recorded on the output move; accounting valuation allocation is
  part of the later manufacturing costing slice.
- BOM row actions now author a byproduct through the generated reducer input and
  resolve the exact `(BOM, product, company)` row from the registered
  `mrp-bom-byproducts` resource. Duplicate relations fail closed.
- `cov07g-bom-byproducts.spec.ts` exercised warehouse UI definition creation
  and MO finish, exact definition ownership, scaled output move/quant effects,
  replay rejection and permission preservation in the historical Docker lane.
  Both runs passed all 46 tests, including COV-07f/g; the second run proved
  durable projection convergence. See
  [`cov-runtime-docker-acceptance-2026-10-04.md`](../evidence/cov-runtime-docker-acceptance-2026-10-04.md).
- The evidence note's 2026-10-07 follow-up passed two PostgreSQL upgrade tests
  at contracts v0.3.86. It closes the released-migration blocker without adding
  new byproduct browser proof.
- Historical confirm/start/produce and BOM/MO creation are fixture setup.
  Direct result navigation remains open: row submission discards the exact
  byproduct reference. Lot/serial output and actual accounting valuation remain
  separate completion-stack slices.
- Repeat the relevant persisted/browser/projection gates on the final contract
  pin and immutable completion-stack head. Historical passing tests do not
  certify that new head or promote the module beyond U2/review; see
  [`erp-cov07-completion-stack-plan.md`](./erp-cov07-completion-stack-plan.md).
