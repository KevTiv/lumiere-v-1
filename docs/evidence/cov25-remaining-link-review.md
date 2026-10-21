# COV-25 remaining cross-module links — REVIEW / NOT ACCEPTED

Task base: `77e3e495af2265be07d36854f7c9740dab435056`.

This review inventories the first sale-order handoff and every explicitly named next link in
`docs/plan/erp-cov25-cross-module-links-status.md`. The 2026-10-03 acceptance result remains immutable:
it proved only the first sales-order → delivery link and is not acceptance evidence for these changes.

## Explicit link matrix

| Source → result | Stable canonical relation and scope | Cardinality / ambiguity rule | Destination | Implementation / browser evidence |
| --- | --- | --- | --- | --- |
| Sale order → delivery | `stock_picking.sale_id = sale_order.id`; same org/company, no returns/cancelled documents | 0..N; existing builder lists each child rather than privileging one | `/inventory?tab=transfers&filter=id:N` | Existing UI retained; COV25 order spec now asserts a real click, reload, back to exact parent, and repeat click |
| Sale order → customer invoice | `account_move.sale_order_id = sale_order.id`; same org/company, `OutInvoice`, not cancelled | 0..N; exact FK set, no last invoice | `/accounting?tab=journal-entries&filter=id:N` | Existing UI retained; order spec now creates invoice via Sales form and clicks its exact sheet link |
| Purchase order → receipt | `stock_picking.purchase_id = purchase_order.id`; same org/company, no returns/cancelled documents | 0..N; all exact children; repeated child PK is invariant failure | Inventory transfers, exact ID | New `purchaseOrderRecordSheet` handoffs tab; `cov25-purchase-handoff-links.spec.ts` clicks generated receipt |
| Purchase order → vendor bill | `purchase_order.invoice_ids[] → account_move.id`; same org/company | 0..N; missing referenced row is unavailable, duplicate relation/target is invariant failure | Accounting journal entries, exact ID | Same sheet; purchase spec receives/bills through existing UI, then clicks exact bill |
| Subscription → billing-run invoice | `subscription_billing_run.subscription_id = subscription.id`, then `invoice_move_id → account_move.id`; same org/company at both hops | 0..N; every run invoice linked, duplicate exact invoice relation is invariant failure | Accounting journal entries, exact ID | New subscription sheet; `cov25-subscription-handoff-links.spec.ts` generates two unique runs through UI and clicks both invoices |
| Subscription → reconciled payment | Domain relation exists: exact run invoice IDs intersect `account_payment.reconciled_invoice_ids[]`; **operator query omits that relation** | 0..N resolver retained with strict missing-field guard; no guessed target | No currently provable operator link | **BLOCKED / governed query projection release dependency**; exact invoices stay clickable with payment-unavailable notice; browser asserts that limit, not payment success |
| Proposal → sale order | `proposal.sale_order_id → sale_order.id`; same org/company | 0..1; None shows no links; missing target is unavailable; >1 exact target suppresses link with invariant alert | `/sales?tab=orders&filter=id:N` | New proposal sheet; `cov25-proposal-handoff-links.spec.ts` awards/converts via UI, clicks exact order; duplicated-read adversarial browser assertion |
| Ticket → related business record | **Absent.** `HelpdeskTicket` has customer/team/stage/agent/SLA refs, not related business-record model/ID | No safe identity to resolve | None invented | **BLOCKED / contract-release dependency**; no link or browser-success claim |

Every browser link assertion checks destination pathname, selected tab, one `filter=id:N`, exactly one visible canonical row,
and the ID filter chip. It reloads the destination, goes back to the exact filtered parent, opens the parent sheet again,
and repeats the actual downstream link click. Direct destination visits are not the link proof.

## Before path / canonical trace

- **Existing sales:** `sales-client.tsx` → `saleOrderRecordSheet` custom handoffs →
  `orderHandoffs` (`query-hooks/hooks/order-to-cash.ts`) → `OrderHandoffLinks`
  (`web/components/order-handoff-links.tsx`) → canonical `stockPickingHref` / `accountMoveHref`.
  `useStockPickings` / `useAccountMoves` consume authorized `/api/query/stock-pickings` / `account-moves`.
  `confirm_sales_order` and `create_invoice_from_sale_order` are already owned by the sales domain.
  The browser previously clicked only a delivery.
- **Purchasing:** `purchaseOrderRecordSheet` exposed owned lines but no downstream navigation.
  `usePurchaseOrders`, `useStockPickings` already supplied order and receipts; `useAccountMoves` is reused for bill targets.
  Domain owners: `purchasing/purchase_orders.rs` order confirmation/receipt relation;
  existing `create_bill_from_purchase_order` updates the order's invoice IDs. No operation signature or mutation behavior changes.
- **Proposals:** `useProposals` projected `sale_order_id`, but the table had no result record link.
  Existing approve/convert actions and `proposals/proposals.rs` remain canonical mutation owners.
  `useSaleOrders` supplies exact authorized target readback. No approval or SOD change is made.
- **Subscriptions:** `useSubscriptions`, `useSubscriptionBillingRuns`, `useAccountMoves` already existed.
  The default subscription projection **does not expose `invoice_ids`**; do not assume the table type means it is readable.
  Billing-run `subscription_id` and `invoice_move_id` are the available stable relation.
  `subscriptions/reducers.rs::generate_subscription_invoice` records the run.
  `billing_helpers.rs::apply_subscription_invoice_payment` calls `register_payment_on_invoice` after successful posting,
  which persists `account_payment.reconciled_invoice_ids`. `useAccountPayments` is reused for that read.
- **Tickets:** `spacetimedb/src/helpdesk/tickets.rs::HelpdeskTicket` supplies no relation to the proposed business-record destination.
  Partner/name/date inference is explicitly rejected.

## After path / query availability

The new pure `query-hooks/hooks/cross-record-links.ts` builders compose only the available canonical relation rows.
The existing `order-handoff-links.tsx` presentation owner now also renders these resolved links.
Components own navigation, not mutation success, retries, authorization, or domain transitions.
Loading and failed dependent queries are not presented as “no linked records”.

Resource registry evidence (`crates/stdb-auth/assets/resource_registry.json`):

| Canonical resource | Required projected fields | Registry location |
| --- | --- | --- |
| `purchase-orders` | `invoice_ids`, `company_id`; mandatory `id`, `organization_id` | lines 4705–4725 |
| `stock-pickings` | `purchase_id`, `sale_id`, `company_id`, `is_return`, `state`; mandatory ID/org | lines 5533–5556 |
| `proposals` | `sale_order_id`, `company_id`; mandatory ID/org | lines 4574–4594 |
| `subscription-billing-runs` | `subscription_id`, `invoice_move_id`, `company_id`; mandatory ID/org | lines 5712–5727 |
| `account-payments` | `reconciled_invoice_ids`, `company_id`; mandatory ID/org | lines 195–216 |
| `subscriptions` | `company_id`; mandatory ID/org; **no `invoice_ids` in default projection** | lines 6017–6032 |

All links delegate to the existing `erp-shared/record-links.ts` owner; there is no new route registry.
API-server query authorization and trusted scope are unchanged. No generated contract is manually edited.

## Typed outcomes / cardinality evidence

Read-only result states are `ready`, `unavailable`, and `invariant_failure`; these are not mutation `Applied` outcomes.
Empty valid 0..N relation sets produce a no-linked-records message. Referenced-but-unreadable targets do not.
All IDs are strictly parsed as u64 without passing through JavaScript `Number` in the application builders.
Six focused unit tests cover zero/one/many, scope, returns/cancellation, missing projection/target,
large IDs, duplicate relation IDs, duplicate targets, and rejection of name/partner/ref-based payment discovery.

The proposal browser test's duplicate-target case injects a corrupted canonical response after proving the real link.
It is adversarial presentation coverage, not evidence that duplicate primary keys can persist in SpacetimeDB.

## Verification and limits

- `git --no-optional-locks diff --check`: passed before this evidence write.
- No install, build, or compiled artifacts were created in this worker's checkout.
- No focused unit/Playwright execution is claimed here. Local runtime probe returned connection status `000`;
  there were no installed frontend dependencies. The coordinator requires one centralized validation environment
  instead of cloned dependency/build targets and has not supplied a compatible runtime to this worker.
- Centralized commands to run:
  - `cd frontend/packages/query-hooks && node --import tsx --test src/hooks/cross-record-links.test.ts src/hooks/order-to-cash.test.ts`
  - `cd frontend/web && pnpm typecheck`
  - `cd frontend/web && PLAYWRIGHT_BASE_URL=<compatible-runtime> E2E_WORKERS=1 pnpm exec playwright test cov25- --project=unauthenticated`
- Source preparation may use existing BFF/owner fixture calls in the proposal spec. The claimed operator proof is the visible
  award/conversion and downstream sheet link click, not those fixture calls or a query response alone.
- Form provisioning, permission-first enforcement, and SOD setup remain coordinator dependencies. No such paths were edited here.
- The written browser path exercises multiple subscription invoices; it has not run here. PO/SO many-child cardinality is
  written as unit coverage only.
- Historical subscription invoices without billing-run records, and pending/unreconciled payments, are **not** covered
  by this bounded relation. Full historical invoice linkage needs a governed projected parent invoice relation.
- Other cross-cutting links listed later in the plan (approvals, opportunities, expenses, project timesheets) are not promoted
  by this handoff slice; they retain their existing independent browser-evidence limits.
- New handoff copy follows the existing component's plain-English copy; translation expansion is deferred.

Contract release required: **no** for the implemented PO/proposal/billing-run invoice links; **yes** for subscription payment
operator linkage and ticket → related business record. Full historical subscription invoice coverage needs a governed
query-field projection decision/release.

Next bounded task: integrate and centrally typecheck/run these focused COV25 specs on one exact compatible runtime head.
Separately define and release the ticket related-record invariant before attempting its link.

## Central runtime feedback — source repair pending rerun

The coordinator's subsequent live run reported three COV25 failures: proposal and subscription canonical source URLs
had the correct `tab=`/ID but selected a different tab; sales invoice submission remained disabled because governed
`sales:create-invoice-from-sale-order` configuration was absent. These are failures, not acceptance.

Proposal and subscription clients now reuse the existing `useModuleTab` URL owner and pass controlled
`activeTab` / `onActiveTabChange` to `ModuleView`. No test-side tab click was added to mask canonical navigation.
The existing exact-ID refresh/back assertions remain the acceptance checks after a centralized rebuild.

The sales invoice test now bounds submit-readiness to 10 seconds with an explicit governed-configuration prerequisite,
and intended `create_invoice_from_sale_order` dispatch/readback response to 30 seconds. It does not enable a static fallback.
Parent/coordinator owns provisioning. Canonical form fields are in `sales-form-configs.ts::createInvoiceFromSaleOrderForm`:
required select fields `journalId`, `defaultIncomeAccountId`, `receivableAccountId`; optional `receivableLineName`, `narration`;
checkbox defaults `incomeExcludeFromInvoiceTab=false`, `incomeBlocked=false`,
`receivableExcludeFromInvoiceTab=true`, `receivableBlocked=false`.

`git --no-optional-locks diff --check` passes for these repairs. No worker build, installation, service change,
or successful runtime rerun is claimed.

## Payment projection runtime finding — supersedes registry-only availability

The coordinator's live `account-payments` read returned `amount`, `companyId`, `currencyId`, `id`, `journalId`, `name`,
`organizationId`, `partnerId`, `ref`, `state`, but **not** `reconciledInvoiceIds`. The local resource registry entry lists
the relation; that is insufficient evidence that the accepted HTTP projection exposes it. The payment-availability claim
in the original source trace is therefore withdrawn.

`useAccountPayments` calls `useTypedStdbQuery("account-payments", ...)` with stale/enabled options only. Existing server
queries use trusted `resolve_http_sql_columns`; no browser-authorized explicit projection override was found.
`payment-reconciliations` is a different payment-transaction allocation resource. Subscription payment posting calls
`register_payment_on_invoice`, not the allocation transition that records `PaymentReconciliation`, so using that resource
would not prove this exact subscription result. No owner SQL, payment reference, partner, paid-state, or newest-record
fallback is introduced. The operator payment link is a true governed projection/release blocker.

The existing query/presentation owners now separate independent run invoices from the payment relation:
strict omitted/malformed payment-relation checks suppress all payment links, retain verified invoice links, and render
`subscription-handoff-payment-unavailable`. Payment query errors/loading likewise do not suppress exact invoices.
Payment-target ambiguity produces a payment-specific invariant notice without hiding independent invoices.
The focused subscription browser spec clicks/reloads/returns through both exact generated invoices, then explicitly asserts
the current missing-relation notice and absence of payment links. Its title names the payment blocker. It neither skips nor
claims payment acceptance. Its missing-field assertion requires scoped payment fixture rows; an empty fixture fails rather
than being misrepresented as projection evidence.

Next payment task: producer/release owner exposes a scoped canonical invoice-to-payment relation, verifies the actual
operator HTTP read on the released contract, and then restores the true payment-action/link-click browser acceptance path.
