# COV-06g Quality-check fail exact quarantine convergence

**Package:** `COV-06g`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #69 / `codex/cov06f-serial-tracked-picking`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06g-quality-fail-quarantine.spec.ts`](../../frontend/web/tests/e2e/cov06g-quality-fail-quarantine.spec.ts)

## Bounded path

```text
one on-hand StockQuant @ source location, qty 10 (one product, no lot)
→ one QualityCheck against that product
→ warehouse-manufacturing operator
→ Inventory / Quality checks: fail (qty 1, explicit quarantine location)
→ fail_quality_check → quarantine_quantity
→ exact source StockQuant.id remains @ source, qty 9
→ exactly one identity-matching StockQuant.id @ quarantine location, qty 1, available 0
→ navigate to exact quarantine quant
```

## Changes

- `resolve_quality_source_location` (`spacetimedb/src/inventory/quality.rs`) picked the first on-hand quant location it iterated over when no picking tied the check to a location — a known, previously undocumented-as-fixed defect: an existing native test (`test_quality_fail_quarantines_from_atp`) carried a comment explaining it had to delete the harness's seed quant "so only the quant this test creates below is a candidate," working around exactly this ambiguity rather than fixing it. Fixed to fail closed when on-hand stock for the product/lot exists at more than one location, instead of guessing.
- `quarantine_quantity` (`spacetimedb/src/inventory/stock.rs`) merged into the first compatible quant it found at the quarantine location — the same "first match wins" defect class `move_stock_quant` had before COV-06c. Fixed to fail closed on multiple compatible destination quants, mirroring `move_stock_quant`'s exact pattern, and now records a durable organization commit (`erp.quarantine_quantity`) carrying the exact source/destination quant ids touched.
- Added two native domain tests (`test_quality_fail_ambiguous_source_rejected`, `test_quality_fail_ambiguous_destination_rejected`, both wired into `run_inventory_qc_quarantine_test`) proving both fail-closed paths reject the ambiguous case without mutating any quant.
- Added a typed `inventory.quality-check.fail` workflow (`frontend/packages/erp-workflows/src/inventory/quality-check-fail.ts`) that snapshots the exact on-hand source quant and optional existing quarantine-location quant before dispatch — bounded to exactly one on-hand source candidate and at most one compatible destination, same shape as `quant-movement.ts`. Readback verifies exact source depletion (same id reduced, or gone when fully consumed) and exact quarantine convergence (same id increased, or exactly one new id created), always with `available_quantity = 0`.
- The "Fail check" row action (`frontend/web/app/(modules)/inventory/inventory-client.tsx`) now calls the typed workflow instead of the previous raw mutation hook (`useFailQualityCheck`, removed in favor of `failQualityCheckCommand` + `useQualityCheckFailWorkflow`).
- **Found while wiring the UI**: `wh_qc_stock_loc_id` on `Warehouse` is set-once at `create_warehouse` time and has no update path anywhere in the reducer surface (`UpdateWarehouseParams` doesn't carry it), and the dev seed's warehouse leaves it `None`. `fail_quality_check`'s own fallback to a configured warehouse QC location was therefore dead in practice — every real "fail" call needed an explicit `failure_location_id` already, or it would always error. The UI now still prefers a configured warehouse QC location when one exists, but falls back to prompting the operator for a quarantine location id, so the action is actually usable against the current seed. Making the field configurable via a dedicated reducer is a separate, smaller gap, not addressed here.
- Browser proof: create a product, an on-hand quant, and a quality check; fail it through the UI with an explicit quarantine location; verify exact source depletion and exact one-quant quarantine convergence with `available_quantity = 0`; verify canonical navigation to the exact quarantine quant; verify exact replay (already-completed check) is rejected (422); verify the limited reader is denied (403) without changing any quant.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06g_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06g-e2e
PG_DATABASE=lumiere_cov06g_e2e make e2e-single \
  E2E_SPEC=cov06g-quality-fail-quarantine.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06g-e2e
spacetime call <db> run_all_inventory_tests
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one quality check for one on-hand, untracked product with exactly one candidate on-hand location and at most one pre-existing quarantine quant. It does not certify lot/serial-tracked quality checks, picking-tied source-location resolution (the picking-based branch of `resolve_quality_source_location` is untouched and uncertified here), `pass_quality_check`, the quality-alert lifecycle, or quality points/teams.

## Next bounded Inventory slice

Replenishment (`execute_replenishment_rule` — described in the investigation doc as "still timestamp-only, unsuitable for ops demand") is the remaining named candidate. A configurable warehouse QC location (a dedicated reducer, since none exists) is a smaller, separate gap surfaced by this slice.
