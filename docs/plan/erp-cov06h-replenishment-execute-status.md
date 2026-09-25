# COV-06h Replenishment buy-demand exact execution

**Package:** `COV-06h`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #70 / `codex/cov06g-quality-fail-quarantine`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06h-replenishment-execute.spec.ts`](../../frontend/web/tests/e2e/cov06h-replenishment-execute.spec.ts)

## Bounded path

```text
one replenishment rule (product below min at an empty location, vendor configured)
→ warehouse-manufacturing operator
→ Inventory / Replenishment: execute rule
→ execute_replenishment_rule → create_buy_demand
→ exactly one draft PurchaseOrder with partner_ref = "RPL-<ruleId>"
→ idempotent replay with the same idempotency key: the exact same PO id, no duplicate
→ navigate to the exact draft PO
```

## Changes

- `create_buy_demand` and `create_transfer_demand` (`spacetimedb/src/inventory/replenishment.rs`) rediscovered the row they had just inserted by `.max_by_key(|o| o.id)` / `.max_by_key(|p| p.id)` — the same "highest id" shape as the newest-row defects fixed elsewhere in COV-06. Both now collect matches and fail closed if more than one exists, matching `move_stock_quant`'s established idiom, with the same open/not-done-or-cancelled scope the preceding dedup check already used (so a prior completed PO/picking sharing the identity string does not falsely trip the new check).
  - **Honesty note, unlike prior slices**: this one is not a demonstrated bug. SpacetimeDB reducers execute serialized and this reducer's own dedup check runs immediately before the insert and returns early on any match, so the ambiguous branch this change guards against cannot currently be reached through the reducer's own call graph — there was no way to write a red test proving it. It is kept as defense-in-depth consistent with the rest of the codebase's stated convention, not presented as a fixed defect.
- Added a typed `inventory.replenishment.execute` workflow (`frontend/packages/erp-workflows/src/inventory/replenishment-execute.ts`) scoped to the buy-demand path: snapshots the optional pre-existing draft PO for the rule's exact `partner_ref` identity before dispatch, and verifies exact convergence after — the same id for an idempotent replay, or exactly one new id created. More than one compatible PO fails preflight.
- The "Execute rule" row action (`frontend/web/app/(modules)/inventory/inventory-client.tsx`) now calls the typed workflow instead of the previous raw mutation hook (`useExecuteReplenishmentRule`, removed in favor of `executeReplenishmentRuleCommand` + `useReplenishmentExecutionWorkflow`).
- Browser proof: create a product with a configured vendor and a rule whose location is below min; execute through the UI; verify exactly one draft PO with the exact `partner_ref` identity now exists; verify a direct replay with the same idempotency key keeps the exact same PO id (no duplicate); verify canonical navigation to the exact PO; verify the limited reader is denied (403) without creating or changing any PO.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06h_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06h-e2e
PG_DATABASE=lumiere_cov06h_e2e make e2e-single \
  E2E_SPEC=cov06h-replenishment-execute.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06h-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies only the buy-demand path (a vendor is configured for the product) for one rule with no pre-existing PO. It does not certify: the internal-transfer demand path (`create_transfer_demand`, no vendor configured — a source-location-with-stock lookup instead), the "no demand needed" outcome (available quantity already at or above min), rule creation/deactivation, `find_source_location_with_stock`'s arbitrary-but-valid source selection among multiple candidate locations (a design choice, not a correctness defect), or a scheduler for `next_run` (the field is still stamped but nothing consumes it automatically — a separate, larger gap).

## Next bounded work

A scheduler that actually fires `execute_replenishment_rule` at each rule's `next_run` (currently just an inert timestamp field) is the largest remaining replenishment gap, but is a different shape of task — a new scheduled-table subsystem, not a certification or first-match-wins fix — and was deliberately left out of this bounded slice.
