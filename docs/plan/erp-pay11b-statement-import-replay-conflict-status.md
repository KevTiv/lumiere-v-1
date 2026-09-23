# PAY-11B — conflicting statement-import replay

Status: **IMPLEMENTED — runtime proof pending**

Stack base: PR #80 (`codex/pay05-reversal-retry-idempotency`).

## Scope

PAY-11B closes the conflicting idempotency-key replay defect in
`stage_bank_statement_import`.

The reducer previously treated any existing import with the same
organization/company/key as a successful no-op, even when journal, currency,
opening balance, file metadata, or parsed rows differed.

Statement staging now uses the canonical accounting operation receipt:

- the receipt identity is scoped by organization, company, action and key;
- the payload fingerprint includes journal, currency and the complete parsed
  `StageBankStatementImportParams`;
- an exact replay returns success and the original import identity;
- a reused key with different input returns an explicit idempotency conflict;
- conflicting replay does not mutate the staged import or lines;
- one successful import produces one receipt and one CREATE audit.

A legacy import row with no matching receipt fails closed rather than accepting
an unverifiable replay.

## Changes

- wire `stage_bank_statement_import` through `replayed_result` /
  `record_result`;
- change the operation contract from `non_idempotent` to `idempotent`;
- strengthen PAY-11A/B to prove exact replay, one receipt, immutable staged rows,
  and explicit conflicting-input rejection;
- extend the existing bank-statement browser proof with a conflicting replay;
- remove PAY-11B from the strict native/documented known-defect registries.

## Deliberately excluded

- CSV parser extraction/BOM/delimiter/localized-decimal work;
- statement approval semantics;
- import correction/edit workflows;
- REC-01 durable reconstruction coverage.

## Acceptance

```bash
cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests
make pretenant-cert-native
make check-codegen-pinned

# Against a freshly published local stack:
spacetime call <db> run_accounting_payment_management_test --server local --no-config
make e2e-single E2E_ONLY_SPEC=bank-statement-import.spec.ts
```

Do not mark PAY-11B accepted until the native/in-module, contract and focused
browser proofs pass on this branch.
