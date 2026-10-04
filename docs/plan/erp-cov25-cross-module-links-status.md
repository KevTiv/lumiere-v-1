# COV-25 — Close one missing downstream record link per PR

**Status:** IMPLEMENTED for sale order → delivery/invoice and purchase order → receipt/vendor bill (runtime acceptance pending); further links are one per PR  
**Module/surface:** Cross-module  
**Plan target:** direct navigation for primary handoffs  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: all T0 modules

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: n/a

## Effect contract

Each PR removes one "go search the other module" step by linking a generated downstream record directly.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none when the relation is already projected; release otherwise



## Implementation — link 1: sale order → its deliveries and invoices

The sale-order record sheet had a lines tab but no way to reach the deliveries or invoices the order
generated; an operator searched Inventory or Accounting for them. The sheet now has a **Deliveries &
invoices** tab (`sales-client.tsx`) listing, by exact foreign key (`stock_picking.sale_id`,
`account_move.sale_order_id`, same organization and company; returns and cancelled documents excluded), each
delivery and customer invoice with its state and open balance, linking to the canonical record:
`/inventory?tab=transfers&filter=id:N` and `/accounting?tab=journal-entries&filter=id:N` (the invoices tab is a custom list that ignores `filter=`). It reuses the same
`orderHandoffs` builder and `OrderHandoffLinks` component as the COV-24 workspace, so there is one definition of
"this order's downstream records". No contract delta (the relation fields are already projected).

**Next links (one per PR, not done):** subscription → invoice and payment, proposal →
sale order, ticket → record.

## Prerequisites / decisions

COV-03..24 candidates.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | N/A — a read-only link; no operation or state is added. |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | Inherited — the sheet reads only through the existing authorized queries; the builder drops rows outside the organization or company (unit-tested). |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — `frontend/web/tests/e2e/cov25-order-handoff-links.spec.ts`: a draft order shows none, a confirmed order lists exactly its delivery with the canonical href, and the link lands on that transfer. **Not run in this environment.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Builder unit test DONE (`order-to-cash.test.ts`, 12 tests, passing). No mutation to replay. |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).

## Canonical record links (cross-cutting)

A record link is `/{module}?tab={tab}&filter=id:{id}`; `tab` and `filter` are the only parameters any module
reads. `@lumiere/erp-shared/record-links` now owns the builder (`buildModuleTabHref` in `@lumiere/ui` delegates
to it) and one helper per record type. Links that used parameters no module reads — and so only landed on the
default tab — were replaced:

| Link | Was | Now |
| --- | --- | --- |
| Approval inbox → purchase order, sale order, account move, payment, expense sheet | `?po=`, `?so=`, `?invoice=`, `?payment=`, `?sheet=` | `purchaseOrderHref`, `saleOrderHref`, `accountMoveHref`, `accountPaymentHref`, `expenseSheetHref` |
| Opportunity conversion → sale order | `/sales?orderId=` | `saleOrderHref` |
| Expense sheet → posting / reimbursement / rebill entry | `/accounting?tab=journal-entries&highlight=` | `accountMoveHref` |
| Project margin widget → timesheets | `/projects?tab=timesheets&projectId=` | `projectTimesheetsHref` (`filter=projectId:`) |
| Order deliveries and invoices (COV-24/25) | — | `stockPickingHref`, `accountMoveHref` |

Unit test: `record-links.test.ts` (3 tests, passing). Not verified in a browser: that each target tab applies the
filter. Entity tabs do (`EntityTable.initialFilters`); the Accounting "invoices" and "bills" tabs are custom lists
that ignore it, which is why account moves link to "journal-entries".

## Implementation — link 2: purchase order → receipts and vendor bills

The Purchasing order record sheet adds **Receipts & vendor bills**, reusing
`OrderHandoffLinks` and the canonical `stockPickingHref` / `accountMoveHref`
builders. Receipts require exact `stock_picking.purchase_id`, incoming direction,
and matching organization/company. Bills come only from the selected PO's
durable `invoice_ids` relation and resolve to same-scope `InInvoice` moves.
Returns, refunds and cancelled records are excluded. Names and invoice origins
are display values, never identity selectors.

Loading and failed/denied queries have distinct status/alert text; a failed
query is not presented as a successful empty handoff list. Existing authorized
queries remain the access boundary. This read-only slice adds no domain state,
mutation or generated contract delta.

Validation:
- `purchase-order-handoffs.test.ts` covers exact relation selection, parent and
  child scope, returns/cancellations/refunds, snake-case/option IDs, large IDs,
  missing relations and rejection of name/origin-based discovery.
- The focused pure tests passed using Node's TypeScript support in this
  environment, with import paths adjusted only in temporary verification copies.
- `cov25-purchase-handoff-links.spec.ts` creates a PO through the existing UI
  fixtures, verifies an unrelated draft stays empty, follows the exact receipt
  and vendor bill, and checks filtered record focus survives refresh.
- Full workspace typecheck and browser execution remain pending GitHub CI:
  local Git/network access is unavailable in this environment.

This link remains **IMPLEMENTED — runtime acceptance pending** until same-head
CI and the focused browser proof pass; it does not promote the whole COV-25 track.
