# COV-06m Replenishment internal-transfer exact execution

**Package:** `COV-06m`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #75 / `codex/cov06l-serial-use-block-lifecycle`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06m-replenishment-transfer-demand.spec.ts`](../../frontend/web/tests/e2e/cov06m-replenishment-transfer-demand.spec.ts)

## Real gap this closes

COV-06h scoped the internal-transfer demand path out as "not certified." Extending it surfaced that it was worse than uncertified: the typed `inventory.replenishment.execute` workflow only ever checked purchase orders for its outcome. A rule with no configured vendor takes the transfer path (`create_transfer_demand`, producing a `stock_picking` instead), and the workflow would never find a matching purchase order — it would report **no outcome at all** for a transfer-demand execution that actually succeeded server-side. This slice fixes that false-negative rather than just adding new coverage.

## Bounded path

```text
replenishment rule (product below min at an empty location, no vendor configured, a source location with sufficient stock)
→ warehouse-manufacturing operator
→ Inventory / Replenishment: execute rule
→ execute_replenishment_rule → create_transfer_demand
→ exactly one open internal-transfer StockPicking named "INT-RPL-<ruleId>"
→ idempotent replay with the same idempotency key: the exact same picking id, no duplicate
→ navigate to the exact picking
```

## Changes

- `captureReplenishmentExecutionSnapshot`/`observeReplenishmentExecution` (`frontend/packages/erp-workflows/src/inventory/replenishment-execute.ts`) now take both purchase-order and stock-picking rows and check both identities: the exact draft PO (`partner_ref = "RPL-<ruleId>"`) for the buy path, and the exact open internal-transfer picking (`name = "INT-RPL-<ruleId>"`, excluding done/cancelled) for the transfer path — matching the same open-only scope the reducer's own dedup check uses, so a prior completed picking sharing the name doesn't falsely count as a pre-existing demand. A rule only ever produces one type of demand; the workflow reports success on whichever single side actually changed, not both and not neither.
- `useReplenishmentExecutionWorkflow` now fetches both `purchase-orders` and `stock-pickings` before dispatch and after, in parallel.
- No UI changes — the "Execute rule" action already called this same workflow; it now reports its outcome correctly regardless of which demand type the rule triggers.
- Browser proof: a product with no vendor and an on-hand source location; execute through the UI; verify exactly one open transfer picking with the exact `"INT-RPL-<ruleId>"` identity now exists; verify a direct replay with the same idempotency key keeps the exact same picking id (no duplicate); verify canonical navigation to the exact picking; verify the limited reader is denied (403) without creating or changing any picking.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06m_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06m-e2e
PG_DATABASE=lumiere_cov06m_e2e make e2e-single \
  E2E_SPEC=cov06m-replenishment-transfer-demand.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06m-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies the transfer-demand path for one rule with no pre-existing picking and a single eligible source location. It does not certify the "no demand needed" outcome (available already at or above min — the workflow correctly reports no outcome for this case, but it isn't separately proven here), `find_source_location_with_stock`'s arbitrary-but-valid source selection among multiple candidate locations, or a scheduler for `next_run`.

## Next bounded work

The remaining named gaps in this lineage are the "no demand needed" outcome (a straightforward addition to this same workflow/spec if pursued) and a scheduler consuming `ReplenishmentRule.next_run` — the latter is a materially larger, separate task (a new scheduled-table subsystem).
