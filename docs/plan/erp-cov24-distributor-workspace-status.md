# COV-24 — Order → delivery → collection exception workspace

**Status:** IMPLEMENTED — read-only order-to-cash exceptions (runtime acceptance pending)  
**Module/surface:** Distributor workspace  
**Plan target:** order through delivery/collection exception  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /distributor

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: sale-orders, stock-pickings, account-moves (reused)

## Effect contract

Workspace actions must reuse the canonical CRM/Sales/Inventory/Finance operations and their readbacks — no distributor-local state.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none expected (composition over existing resources)



## Implementation

`/distributor` was a metrics-only page (open orders, balances, payments, low stock). It now also shows an
**Order-to-cash exceptions** panel when the company's distributor pack is enabled. It is a read-only
composition: nothing is stored, and no workspace-local action or state exists — every action stays in the
canonical Sales, Inventory and Accounting surfaces the panel links to.

- **Builder:** `orderToCashRows` / `orderHandoffs`
  (`frontend/packages/query-hooks/src/hooks/order-to-cash.ts`) link an order to its deliveries and customer
  invoices by exact foreign key — `stock_picking.sale_id` and `account_move.sale_order_id` — inside one
  organization and company (never by name, reference or newest row); returns, cancelled documents and
  non-invoice moves are excluded. Only confirmed (`Sale`) and locked (`Done`) orders are order-to-cash.
- **Stage and exceptions:** `to_deliver` → `to_invoice` → `to_collect` → `settled`, with the exceptions
  `no_delivery`, `delivery_incomplete`, `not_invoiced`, `collection_overdue` (an open posted invoice past
  `invoice_date_due`) and `credit_hold` (the customer has `payment_hold` in the company). Orders with no
  exception are not listed.
- **UI:** `distributor-client.tsx` renders the table; each row links to the order, its deliveries and its
  invoices through the shared `OrderHandoffLinks` (`frontend/web/components/order-handoff-links.tsx`), whose
  hrefs are the canonical `buildModuleTabHref(module, tab, { id })` deep links.
- **No contract delta:** every relation field is already projected (`sale_id`, `sale_order_id`, `partner_id`,
  `payment_hold`, `invoice_date_due`, `amount_residual`).

## Prerequisites / decisions

COV-04, COV-06, COV-08, COV-19 accepted.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | N/A — the workspace adds no operation, state or reducer; the order, picking and invoice transitions it links to are covered by COV-04, COV-06 and COV-08. |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — the panel reads only through the existing authorized queries (rows outside the organization or company are filtered by the builder, covered by unit tests); the spec asserts a reader sees no row. **Spec not run in this environment.** |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — `frontend/web/tests/e2e/cov24-distributor-workspace.spec.ts`: a confirmed order shows `delivery_incomplete` / To deliver, a draft order is absent, links are the exact canonical hrefs, the picking link lands on that transfer, and after the delivery is validated through Inventory the row moves to To invoice / `not_invoiced`. **Not run in this environment.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Builder unit test DONE (`order-to-cash.test.ts`, 12 tests, passing: exact keys, scope, returns/cancelled, each stage and exception, ordering). There is no mutation to replay. |

**Not covered:** the invoiced, overdue and credit-hold exceptions are proven by unit tests only; the spec stops at
`not_invoiced` because creating and ageing an invoice is covered by the Sales and Accounting tracks.

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
