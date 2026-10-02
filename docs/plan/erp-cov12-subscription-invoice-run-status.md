# COV-12 — One recurring invoice run

**Status:** PARTIAL — invoice run IMPLEMENTED (contract release and runtime acceptance pending); invoice payment still scaffolded  
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
- **Not in this slice:** `pay_subscription_invoice` exact readback (invoice payment state) and the
  scheduler-driven recurring job proof remain pending. The subscriptions form still does not
  surface a failed run to the operator.

## Prerequisites / decisions

Scheduler replay proof needs the recurring job id exposed or a native test.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN — `test_subscription_invoice_run_replay_is_exact` in `spacetimedb/tests/subscriptions/wave_a_test.rs` (registered in `run_subscriptions_wave_a_test`): default key format, run carries company and its OutInvoice, a same-period replay leaves the run row, invoice move and subscription links unchanged. **Not run in this environment (no Rust build); runs in CI.** |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(subscription, write)` + `account_move:create` + organization and company guards; reader replay asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN for the run — Generate invoice from the Subscriptions toolbar against the seeded `SUB-ACME-001` in `frontend/web/tests/e2e/cov12-subscription-invoice-run.spec.ts`. Payment (`pay_subscription_invoice`) pending. **Spec not run in this environment; runs in CI after the contract release.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Resolver unit test DONE for the run (passing); browser assertions WRITTEN — `subscription-invoice-run.test.ts` (8 tests, passing). A replay is an idempotent success (not 422), so the spec asserts the run snapshot and total move count are unchanged; the reader's 403 leaves them unchanged |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
