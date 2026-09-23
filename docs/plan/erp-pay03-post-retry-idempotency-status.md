# PAY-03 — committed payment-post retry idempotency

Status: **IMPLEMENTED — runtime proof pending**

Stack base: PR #78 (`codex/pay06-overpayment-partial-multi-invoice`).

## Scope

PAY-03 closes the lost-response retry defect for `post_payment_transaction`.

A retry after a transaction has already committed as `Posted` now returns success without:

- re-running guarded approval;
- creating another `AccountPayment`;
- creating another ledger move;
- writing another POST audit.

The replay succeeds only when the posted transaction still points to a valid in-scope committed ledger payment and posted move. Missing or inconsistent linkage fails closed. `Reversed` and `Voided` transactions remain non-postable.

## Changes

- recognize `Posted` as an idempotent replay state in `post_payment_transaction_impl`;
- validate the existing `AccountPayment` and posted `AccountMove` before returning replay success;
- update the payment-management domain test to require retry success and stable effect identity;
- remove PAY-03 from the strict native known-defect registry;
- promote PAY-02-E2E and M-02 from expected-failure wrappers to blocking assertions;
- remove PAY-03 from the documented known-defect table.

## Deliberately excluded

- PAY-05 reversal retry semantics;
- allocation idempotency;
- statement-import idempotency;
- provider dispatch/network retry policy outside the already-written M-02 browser scenario.

## Acceptance

```bash
cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests
make pretenant-cert-native

# Against a freshly published local stack:
spacetime call <db> run_accounting_payment_management_test --server local --no-config
make e2e-pretenant E2E_ONLY_SPEC=pretenant-payment-adversarial.spec.ts E2E_GREP=PAY-02-E2E
make e2e-pretenant E2E_ONLY_SPEC=pretenant-mobile-resilience.spec.ts E2E_GREP=M-02
```

Do not mark PAY-03 accepted until the native/in-module and focused browser proofs pass on this branch.
