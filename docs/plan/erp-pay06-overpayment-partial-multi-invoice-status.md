# PAY-06 — overpayment / partial multi-invoice correctness

Status: **IMPLEMENTED — runtime proof pending**

Stack base: PR #56 (`codex/erp-convergence-cov00a-cov02`).

## Scope

PAY-06 certifies that payment allocation remains explicit rather than inventing economic effects:

- an allocation larger than one invoice residual is rejected without persisting reconciliation state;
- settling that invoice leaves the payment overage as unapplied credit;
- that unapplied amount can then be intentionally allocated as a partial payment to a second invoice;
- invoice residuals and payment clearing residual remain exact;
- neither allocation creates a write-off unless one was explicitly requested.

The previously observed PAY-06-E2E `NaN writeOffAmount` failure was a read-contract defect: the payment reconciliation resource did not expose `write_off_amount` or `write_off_move_id` through the authorized HTTP projection even though the reducer persisted them.

## Changes

- expose `write_off_amount` and `write_off_move_id` for `payment-reconciliations`;
- add a field-policy regression test for the reconciliation outcome projection;
- expand native PAY-06 certification to a 120 payment across 100 + 50 invoices;
- expand PAY-06-E2E to prove rejected over-allocation, explicit 20 unapplied credit, then a 20 partial allocation to the second invoice with 30 residual and no write-off.

## Deliberately excluded

- PAY-03/PAY-04/PAY-05 post/reversal retry work;
- PAY-07 duplicate-reference scope;
- PAY-08/PAY-09 money precision;
- statement import/parser defects;
- automatic invoice selection or auto-allocation policy.

## Acceptance

```bash
cargo test -p stdb-auth field_policy::tests::resolve_http_sql_columns_exposes_payment_reconciliation_outcome
make pretenant-cert-native

# Against a freshly published local stack:
spacetime call <db> run_accounting_payment_management_test --server local --no-config
make e2e-pretenant E2E_ONLY_SPEC=pretenant-payment-adversarial.spec.ts E2E_GREP=PAY-06-E2E
```

Do not mark PAY-06 accepted until the native/in-module and focused browser proofs pass against the same branch.
