# COV-12 — One recurring invoice run

**Status:** IMPLEMENTED — invoice run and invoice payment (contract release and runtime acceptance pending); scheduler replay proof pending  
**Module/surface:** Subscriptions  
**Plan target:** one recurring invoice run  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /subscriptions

Existing operations (already reachable from the frontend command layer):

- `generate_subscription_invoice` — hook: `frontend/packages/query-hooks/src/hooks/subscriptions.ts`
- `pay_subscription_invoice` — hook: `frontend/packages/query-hooks/src/hooks/subscriptions.ts`

Canonical resources: subscriptions, account-moves

## Effect contract

Generated invoice resolves through a stable subscription→invoice relation keyed by (subscription id, billing period); replay/scheduler retry must not double-bill.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required (registry projection only).** `subscription-billing-runs` projected
only `billing_run_key`, `company_id` and `subscription_id`, so the run could not name its invoice.
`crates/stdb-auth/assets/resource_registry.json` now also projects `invoice_move_id`,
`invoice_date`, `period_start` and `period_end` (no reducer or table change).

Contract releases are automatic: pushing the registry or reducer change runs `.github/workflows/release-contracts.yml`, which publishes the next lumiere-contracts version and pins it on the branch. Pull its pin commit before continuing.

## Implementation

- **Reducer:** `generate_subscription_invoice` (`spacetimedb/src/subscriptions/reducers.rs`) is
  idempotent on `billing_run_key` (unique): a replay returns the existing run and invoice and
  does not bill twice. Without an explicit key it defaults to
  `sub:{subscription id}:period:{invoice date seconds}`.
- **Hook:** `useGenerateSubscriptionInvoice`
  (`frontend/packages/query-hooks/src/hooks/subscriptions.ts`) derives that same key
  (`subscriptionBillingRunKey`), reads `/api/query/subscription-billing-runs` back and resolves
  the single run for the same organization, company, subscription and key
  (`resolveSubscriptionInvoiceRunEffect`), then resolves the run's `invoice_move_id` as one
  scoped `account-moves` row (`resolveSubscriptionInvoiceMove`) — never the newest invoice.
  Duplicates throw `AmbiguousOperationEffectError`. Reducer errors now carry their message.
- **Payment:** `usePaySubscriptionInvoice` reads the invoice move's open residual before dispatch, then
  resolves the same invoice (exact id, organization, company) after it with a lower residual and a
  `Paid` or `Partial` payment state (`resolveInvoicePaymentEffect`, `subscription-invoice-payment.ts`). A
  payment held for approval leaves the invoice untouched and is reported as such. `pay_subscription_invoice`
  defaults its amount to the open residual, so a replay of a full payment is rejected (the amount is then
  zero); a replay of an explicit partial amount would pay again until the residual clears.
- **UI defect fixed:** the Apply payment form built its invoice options from `subscription.invoice_ids`, which
  the `subscriptions` projection does not expose, so the invoice select was always empty. Options now also
  come from the subscription's billing runs (`useSubscriptionBillingRuns`, `invoice_move_id` now projected).
  The cancel form's credit-note invoice options have the same defect and are unchanged here.
- **Not in this slice:** the scheduler-driven recurring job proof. The subscriptions form still does not
  surface a failed run or payment to the operator.

## Prerequisites / decisions

Scheduler replay proof needs the recurring job id exposed or a native test.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN — payment: `test_pay_subscription_invoice_clears_residual` (`wave_b_test.rs`) now also replays the payment and asserts it is rejected with the invoice state, residual, total and move count unchanged; run: `test_subscription_invoice_run_replay_is_exact` in `spacetimedb/tests/subscriptions/wave_a_test.rs` (registered in `run_subscriptions_wave_a_test`): default key format, run carries company and its OutInvoice, a same-period replay leaves the run row, invoice move and subscription links unchanged. **Not run in this environment (no Rust build); runs in CI.** |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(subscription, write)` + `account_move:create` + organization and company guards; reader replay asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — Generate invoice, then Apply payment, from the Subscriptions toolbar against the seeded `SUB-ACME-001` in `frontend/web/tests/e2e/cov12-subscription-invoice-run.spec.ts`; payment replay returns 422 and the reader 403. **Spec not run in this environment; runs in CI after the contract release.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Resolver unit tests DONE (passing): `subscription-invoice-run.test.ts` (8 tests) and `subscription-invoice-payment.test.ts` (7 tests); browser assertions WRITTEN. A replay is an idempotent success (not 422), so the spec asserts the run snapshot and total move count are unchanged; the reader's 403 leaves them unchanged |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
