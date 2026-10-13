# COV-04 Sales order confirmation convergence

**Package:** `COV-04`
**Disposition:** `ACCEPTED` — bounded sale-order confirmation slice only
**Base:** `f585aadf5a64c8db79030daad93b4204d89b52d9`
**Operator proof:** [`../../frontend/web/tests/e2e/cov04-sales-order-confirmation.spec.ts`](../../frontend/web/tests/e2e/cov04-sales-order-confirmation.spec.ts)

## Accepted path

```text
sales-crm operator
→ Sales orders table / Confirm action
→ useSaleOrderWorkflow
→ erp.confirm_sales_order
→ confirm_sales_order reducer
→ same SaleOrder.id in Sale state
→ every non-return StockPicking.sale_id effect
```

The slice reuses the existing Sales surface, typed workflow runner, generated named operation, API operation route, STDB reducer, and canonical sale-order/picking relations. It adds no sibling mutation authority and no generated-contract change.

## Result

- the stable result is the same sale order record whose state transitions from Draft to Sale;
- fulfillment is treated as one-to-many: every exact non-return picking linked by `sale_id` is reported, while no arbitrary first picking is promoted as the result record;
- the versioned `sales-crm` persona has only the picking read plus picking/move create capabilities exercised by the canonical confirmation reducer;
- the browser setup creates a deterministic draft order and line, then `fixture.sales@example.test` performs the exact confirmation through the visible Sales action;
- canonical readback observes one linked picking for the one-route fixture;
- canonical readback navigates to the same sale order through `/sales?tab=orders&filter=id:<orderId>`;
- the record filter survives refresh, shows exactly the canonical order, and is removed with browser Back without leaking into saved list preferences;
- a stale second confirmation is rejected and leaves the exact picking set unchanged;
- `fixture.reader@example.test` receives HTTP 403 from the named operation and leaves the same effect set unchanged.

## Executed validation

- `pnpm --dir frontend/packages/erp-workflows test`: 113 passed;
- `pnpm --dir frontend/packages/erp-workflows typecheck`: passed;
- `pnpm --filter @lumiere/ui exec vitest run src/entity-views/entity-table-url-filters.test.tsx src/lib/module-url-filters.test.ts`: eight tests passed;
- `pnpm --filter @lumiere/ui typecheck`: passed;
- `node --import tsx --test hooks/use-workflow-surface.test.ts` from `frontend/web`: three tests passed;
- `pnpm --dir frontend/web typecheck`: passed;
- `pnpm --dir frontend/web first-org-fixture:check`: manifest passed with seven personas and 22 module health rows;
- `pnpm --dir frontend/web exec playwright test tests/e2e/cov04-sales-order-confirmation.spec.ts --project=unauthenticated --list`: one test listed;
- `PG_DATABASE=lumiere_cov03_e2e make e2e-single E2E_SPEC=cov04-sales-order-confirmation.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov03-e2e`: one browser test passed.

## Evidence limit

This accepts one Sales state transition and its same-record navigation. It does not by itself prove the complete fulfillment, invoicing, payment, return, concurrency, responsive/accessibility, or current-head launch lifecycle required for full Sales U4/U5 admission.

## Wave 2 closure implemented on current tree

- confirmation and invoice creation reconcile ambiguous responses from canonical state without redispatching;
- an unchanged order is `approval_pending` only when exactly one active, same-tenant/company `workflow_human_task` names `sale_order` + the exact order ID; duplicate active tasks are an invariant failure;
- the Sales approval workspace uses that same task identity for approve/reject and links to `/approvals?taskId=<exact id>` rather than a model/name/time search;
- order handoffs now resolve paid payments only through scoped `account_payment.reconciled_invoice_ids` intersecting the order's exact invoice IDs; omitted or malformed relations render an explicit unavailable/invariant notice;
- both the order record sheet and dedicated order page expose canonical Accounting payment links;
- the operator RMA browser path now includes receive → exact exchange-order readback/navigation → credit-note creation/posting. Exchange identity is `metadata.exchange_return_id` or the reducer-owned `origin=exchange:RMA/<return id>` stamp, with exactly-one enforcement.

Focused validation on this tree:

- `erp-workflows`: 26 Sales order/return tests passed;
- `query-hooks`: 25 canonical recovery, approval identity, order handoff, and payment relation tests passed;
- Playwright discovery lists the updated authenticated `mvp-sales-returns.spec.ts`; runtime execution still requires the full local service stack.

The remaining Sales-specific U5 work is current-head runtime execution of the expanded RMA and lead-to-cash payment-link assertions, concurrent confirmation/approval adversarial proof, and COV-26 responsive/accessibility certification.

## Next slice

Start COV-05 with one Purchasing order transition under the `purchasing` persona. Use a same-record state transition or a released durable effect identity; receipt and vendor-bill discovery may not choose newest rows or infer identity from ID deltas.
