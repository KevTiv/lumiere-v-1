# COV-07g — exact BOM byproduct output

**Status:** BACKEND IMPLEMENTED — contract/UI and runtime acceptance pending  
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
- Regenerate and release the versioned contract, then wire BOM authoring and
  exact MO output readback in the UI with replay and permission coverage.
- Run native and browser acceptance during stacked integration. This workspace
  does not provide `cargo` or SpacetimeDB tooling.
