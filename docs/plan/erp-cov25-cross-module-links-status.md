# COV-25 — Close one missing downstream record link per PR

**Status:** IMPLEMENTED for sale order → delivery/invoice and purchase order → receipt/vendor bill, and subscription → invoice/payment (runtime acceptance pending); further links are one per PR  
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

**Next links (one per PR, not done):** proposal → sale order, ticket → record.

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

## Implementation — link 3: subscription → invoices and reconciled payments

#149 is merged; #150 now targets `main`. The subscription record sheet adds
**Invoices & payments**. Invoices resolve from the exact scoped billing run's
`invoice_move_id`; payments require an exact `reconciled_invoice_ids` intersection
with those resolved invoices and state Paid. Parent, runs, moves and payments
must all match organization and company. Duplicate billing runs deduplicate the
same invoice; ambiguous target rows are withheld with an unavailable-record alert.
Refunds, cancelled invoices, pending approval payments and reversed payments are
excluded. Names, references and timestamps never select records. A shared payment
may appear for several subscriptions; no payment total is presented as allocation.

The tab distinguishes loading, failed/denied reads, successful empty results and
unresolved billing relations. It uses existing authorized projections and canonical
`accountMoveHref` / `accountPaymentHref` links. There is no mutation, domain state,
generated contract delta or new native-domain test requirement.

Validation:
- `subscription-handoffs.test.ts`: five passing focused tests for exact relations,
  independent scope checks, multiple/shared payments, deduplication, ambiguity,
  missing targets, excluded states, snake-case fields and large option IDs.
  Executed with Node TypeScript support using temporary import-path substitutions.
- Existing COV-12 browser proof gains COV-25 assertions after its visible billing
  and payment actions: exact invoice/payment hrefs, filtered target focus and
  focus preserved after refresh. Existing stale (422) and reader (403) replay
  assertions remain.
- On 2026-10-09, frozen dependency installation, full web typecheck, all 273
  query-hook tests (including the five handoff tests), static i18n checks and
  focused Playwright discovery passed locally.

### PR #150 record-sheet repair

The original targeted CI failure was a client-side crash, not a disabled billing
action. Selecting a subscription opened the newly added record sheet without its
required `detailConfig`; `EntityDetail` then threw while reading `config.sections`.
The Actions trace and error snapshot in run `37222403725` confirm this cause.

The sheet now has an explicit Overview layout using already-projected subscription
fields and existing translations. The browser regression checks Overview rendering
and client errors while retaining the visible generation/payment actions, exact
invoice/payment links, refresh, same-key billing replay, stale-payment rejection
and reader denial. No permissions, billing rules, reducer, projection or generated
contract changed. Fresh local runtime validation and same-head CI remain required;
test discovery and typecheck are not operator-path proof.

Independent review also found that payment completion invalidated only the legacy
payment cache, while the handoff consumes the company-scoped typed payment cache.
Payment resources now use the existing typed invalidation helper and are included
in the subscription workspace resource set. The first payment-link assertion runs
on the already-mounted subscription page, before navigation, reload or switching
to the reader context can mask stale cache data. Unit regressions check the three
handoff resources remain subscribed and typed payment invalidation reaches the
company cache without invalidating another organization's payments.

Same-head E2E run `37949858708` then reached invoice generation and payment but
found no linked payment. Its HTTP trace showed the new Paid payment with both
reconciliation fields absent. The Rust HTTP projection filter discarded all
`_ids` columns unless the resource explicitly opted in; `account-payments` had no
inclusion despite both fields already being declared by the registry and pinned
contracts. The resource now includes only `reconciled_invoice_ids` and
`reconciled_bill_ids`, matching the existing purchase/sale relation pattern.
Explicit field grants still determine the selected columns; the inclusion does
not add fields omitted by a restricted grant or broaden unrelated ID lists.
Rust regressions cover default relation selection, restricted-field preservation
and resource-specific filtering. No schema, operation or generated contract
changes are required. The failed run is not acceptance evidence.

`cargo test --locked -p stdb-auth payment_http` passes all three new regressions.
The full `stdb-auth` suite reports 42 passes and one unrelated existing helpdesk
projection test failure (`user_id` is selected while that test expects it excluded).
The payment fix does not change helpdesk selection or weaken that test.

### Subscription deep-link tab selection

Run `37952671041` progressed through generation, payment, same-page payment links
and invoice navigation/refresh. Returning to
`/subscriptions?tab=subscriptions&filter=id:1` then failed because the module still
displayed Dashboard. Both attempts retained company 275; the HTTP response and
server-rendered page still contained subscription 1. Subscriptions did not use
`useModuleTab` or pass controlled tab props to `ModuleView`, unlike Accounting and
Purchasing, so `defaultTab: "dashboard"` won over the URL.

Subscriptions now reuses the shared URL-tab hook and passes its controlled state
to `ModuleView`. The focused browser proof requires the Subscriptions tab, exact
record filter and single target row both before and after refreshing that return
deep link. It does not click the tab to bypass the route defect. The first
same-page payment-link assertion and existing replay/stale/reader-denial checks
remain unchanged. No filter engine, billing, authorization or contract changes
are part of this navigation repair.

Local validation of the navigation repair passed: full web typecheck, all 273
query-hook tests, all four shared table URL-filter regressions and focused
Playwright test discovery. Actual browser execution and same-head CI are still
required; the earlier failure is retained as diagnostic evidence.

Status remains **IMPLEMENTED — runtime acceptance pending** until same-head CI
and browser proof pass. This does not promote the whole cross-module track.
