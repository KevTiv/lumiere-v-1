# COV-12 — One recurring invoice run

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov12-subscription-invoice-run`  
**Stack base:** `codex/cov11-expense-sheet-lifecycle`  
**Module/surface:** Subscriptions  
**Plan target:** one recurring invoice run

## Bounded path

Operator surface: `/subscriptions` → Subscriptions.

The bounded lifecycle is:

1. select active seeded subscription `SUB-ACME-001`;
2. Generate invoice through the visible `gen-inv` action using a unique
   `billing_run_key`;
3. resolve the exact `subscription_billing_run` row by
   `(subscription_id, billing_run_key)`;
4. follow its exact `invoice_move_id` to the canonical AR `OutInvoice`;
5. Pay the same invoice through the visible `pay-inv` action and reconcile
   that same move to its expected residual/payment state.

No newest-invoice, name or timestamp lookup is used for effect identity.

## Projection / contract change

The domain model already contained the required exact relation:

`subscription_billing_run.invoice_move_id`.

COV-12 only exposes that existing field on the
`subscription-billing-runs` read projection. No table, reducer signature or
business field was added.

This projection change intentionally triggers the automatic contracts release
and branch pin workflow.

The Pay form now sources invoice choices from the billing-run ledger rather
than `subscriptions.invoice_ids`, which is not part of the bounded
subscriptions projection. The visible UI and canonical readback therefore use
the same relationship authority.

## Exact effect contract

### Generate

`resolveSubscriptionBillingRunEffect` requires exactly one run whose:

- organization and company match;
- `subscription_id` is the selected subscription;
- `billing_run_key` is the exact submitted/default key;
- `invoice_move_id` resolves to one same-scope `OutInvoice`.

The hook derives the reducer's default key exactly as
`sub:{subscription_id}:period:{invoice_date_unix_seconds}` when the optional
key is blank.

### Pay

`usePaySubscriptionInvoice` first reads the exact invoice residual. It then
dispatches once and reconciles that same move to:

- `Posted`;
- residual equal to the expected post-payment residual;
- `Paid` when residual is zero, otherwise `Partial`.

This keeps partial-payment behavior valid while still giving lost-response
reconciliation an exact expected effect.

## Replay semantics

COV-12 preserves the domain's intentional retry behavior:

- same `billing_run_key` generation replay: **idempotent success**; one billing
  run and one invoice relation remain;
- generation with a new billing-run key represents a new billing period/run;
- replaying a fully paid invoice payment: rejected because residual is already
  zero; the canonical invoice remains unchanged;
- read-only replay of either operation: 403 before mutation.

Wave A now asserts the single billing-run row points to the single invoice
move. Wave B now asserts full-payment replay rejection leaves the paid invoice
unchanged.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | Existing Wave A idempotent billing test now asserts exact run → invoice relation. Existing Wave B payment test now proves replay after full payment is rejected and leaves the cleared invoice unchanged. | `run_all_subscriptions_tests` passes. |
| A | Existing generated operations retain `subscription:write`, `account_move:create/write` and payment permissions plus organization/company checks. Browser proof requires `fixture.reader@example.test` to receive 403 for generation and payment replays. | Authorized actor succeeds; reader denial preserves exact run/invoice. |
| O | `cov12-subscription-invoice-run.spec.ts` drives Generate Invoice and Apply Payment through the visible Subscriptions table actions/forms. | Focused Playwright proof passes. |
| E | `subscriptions-invoice-effect.test.ts` covers default/explicit run keys, exact scope/relation, ambiguity, and full/partial residual effects. Browser proof preserves the exact billing run/invoice across same-key generation retry, stale payment replay and reader denial. | Unit/native/browser proof green on one head. |

## Acceptance

COV-12 becomes **ACCEPTED** only when the same branch head records:

1. automatic contracts release/pin with `invoice_move_id` in the
   `subscription-billing-runs` projection;
2. query-hooks typecheck + unit tests;
3. `run_all_subscriptions_tests` on a live stack;
4. focused COV-12 Playwright proof;
5. branch CI green.

Until then the truthful disposition is **IMPLEMENTED — runtime acceptance
pending**.
