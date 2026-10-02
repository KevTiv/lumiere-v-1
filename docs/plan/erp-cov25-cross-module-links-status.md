# COV-25 — Close one missing downstream record link per PR

**Status:** IMPLEMENTED for the first link — sale order → delivery and invoice (runtime acceptance pending); further links are one per PR  
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

**Next links (one per PR, not done):** purchase order → receipt and vendor bill, expense sheet → journal entry
(currently `highlight=` rather than the canonical `filter=id:`), subscription → invoice and payment, proposal →
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
