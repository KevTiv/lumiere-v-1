# PAY-05 — committed payment-reversal retry idempotency

Status: **IMPLEMENTED — runtime proof pending**

Stack base: PR #79 (`codex/pay03-post-retry-idempotency`).

## Scope

PAY-05 closes the retry defect for `reverse_payment_transaction`.

A retry after the original payment has already committed as `Reversed` now succeeds only when the previously committed compensation is still coherent:

- exactly one `PaymentReversal` exists for the original transaction;
- its original payment identity matches the transaction;
- the original ledger payment/move remains intact;
- the correcting transaction points back to the original payment, has the opposite direction, preserves amount/currency/partner scope, and is still posted;
- the correcting transaction points to the same correcting ledger payment recorded by `PaymentReversal`;
- the retry reason and metadata match the committed reversal payload.

A changed retry payload fails closed. The replay does not re-run approval, create another correcting transaction/payment, restore allocations a second time, or emit another reversal audit.

## Changes

- generalize the PAY-03 committed-ledger validator for reuse by reversal replay validation;
- recognize `Reversed` as the replay state in `reverse_payment_transaction_impl`;
- validate the durable `PaymentReversal` + original/correcting ledger identities before returning replay success;
- extend PAY-05 to require exact retry success and conflicting-payload rejection;
- keep PAY-04 as the single-compensation proof;
- remove PAY-05 from the strict native/documented known-defect registries.

## Deliberately excluded

- new browser reversal workflow coverage;
- provider chargeback ingestion/callback semantics;
- PAY-11B statement-import replay conflicts;
- reconstruction/durable-commit coverage.

## Acceptance

```bash
cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests
make pretenant-cert-native

# Against a freshly published local stack:
spacetime call <db> run_accounting_payment_management_test --server local --no-config
```

Do not mark PAY-05 accepted until the native/in-module proof passes on this branch.
