# BASE-04 — payment/import correctness completion

Status: **IMPLEMENTATION COMPLETE — acceptance proof pending**

Current tip: `codex/base04-money-pilot-envelope`, stacked on PR #86.

## Delivered stack

- #78 — PAY-06 overpayment / partial multi-invoice allocation and authorized
  reconciliation outcome projection;
- #79 — PAY-03 committed payment-post retry is idempotent and validates the
  original ledger effect;
- #80 — PAY-05 committed reversal retry uses the durable reversal receipt and
  cannot create a second compensation;
- #81 — PAY-11B statement staging uses accounting operation receipts; exact
  replay succeeds and changed payload fails closed;
- #82 — statement CSV parser extraction + UTF-8 BOM certification;
- #83 — canonical CSV-02 US thousands grouping;
- #84 — canonical CSV-03 slash dates fail closed without explicit format/locale;
- #85 — canonical CSV-04 SHA-256 statement import identity;
- #86 — canonical CSV-01 European grouped-decimal parsing;
- this branch — enforced pilot money envelope and BASE-04 closure.

## Money boundary decision

Operational payment/import money remains `f64` for the pilot. The enabled
boundary is explicit rather than implicit:

```text
finite && abs(amount) <= 1_000_000_000 major units
```

The shared accounting guard is applied to:

- payment gross / settlement / net amounts at create, update and post invariant
  validation;
- payment fee and fee-tax amounts;
- allocation and write-off amounts, including their combined economic effect;
- new allocations against legacy payment transactions;
- bank statement opening balance;
- staged statement row amounts, valid-row movement totals and derived closing balance;
- statement approval revalidation for opening balance, row amounts, movement total and closing balance.

Exact idempotent replays are checked before the new-effect boundary where
appropriate, so adding the cap does not turn a previously committed exact retry
into a failure. New economic effects outside the envelope fail closed.

Native certification compares the production 1e9 cap against an integer
minor-unit reference model for 0-, 2- and 3-decimal currencies. The existing
far-outside-envelope characterization remains intentionally red: f64 admission
can diverge around 1e10+, so raising/removing the cap requires an explicit
integer-minor-unit or decimal representation migration.

## Certification changes

- PAY-08 retains many-small and split-allocation exactness;
- PAY-09 now settles at the production cap to the cent, rejects over-cap / NaN /
  infinity payment amounts, rejects non-finite allocation/write-off inputs, and
  asserts no rejected reconciliation persists;
- PAY-10 now treats over-cap statement rows as review-invalid and rejects
  over-cap opening balances, aggregate movements and derived closing balances
  without persisting an import;
- native money tests exercise the production guard directly and run the exact
  minor-unit admission model through the same 1e9 cap.

## BASE-04 acceptance

Do not mark BASE-04 `ACCEPTED` until all relevant proofs have passed on the
integrated stack:

```bash
cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests
make pretenant-cert-native
make check-codegen-pinned

# Freshly published local stack:
spacetime call <db> run_accounting_payment_management_test --server local --no-config

# Focused browser payment/recovery proofs:
make e2e-pretenant E2E_ONLY_SPEC=pretenant-payment-adversarial.spec.ts
make e2e-pretenant E2E_ONLY_SPEC=pretenant-mobile-resilience.spec.ts E2E_GREP=M-02

# Statement import + extracted parser:
make e2e-single E2E_SPEC=bank-statement-import.spec.ts E2E_GREP=
cd frontend/web
node --import tsx --test lib/statement-import-csv.test.ts
pnpm typecheck
```

No additional BASE-04 product-code slice is currently identified. Any failure
from these commands must be classified as either a BASE-04 regression or a
BASE-05 harness/environment issue before promotion.
