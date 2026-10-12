# COV-05h Bill economic correction and price recovery

> Broader support: [COV-05i](erp-cov05i-broader-bill-correction-status.md) extends draft correction to preserved discounts, explicit percentage-tax rows and consistent foreign-currency accounting. The original verification ledger below remains historical.

**Disposition:** `LOCAL_ACTIVATED` — full-stack business acceptance remains deferred.

The existing `update_account_move_line` command adds optional `quantity`,
`price_unit`, `expected_quantity` and `expected_price_unit` fields. Economic
updates require both reviewed values and reject a stale review. Ordinary name,
journal and analytic edits retain their existing path. Economic correction
cannot be mixed with debit/credit or relation patches.

The reducer corrects a never-posted Draft vendor bill by the exact producer-owned
PO-line `invoice_lines` relation. Bill creation stores the exact inserted
expense-line ID on that source line. Missing, duplicate, foreign or dangling
lineage fails; existing ambiguous bills are not guessed or backfilled. The
command validates all bill expense lines and the single payable line before
updating expense economics, payable economics, bill totals/residual, PO billed
quantity, remaining billable quantity and match status in one transaction. It
requires both line-write and move-write permissions in the active company.
Non-finite inputs, excessive quantities, stale edits and posted bills fail.

The Accounting bill detail offers **Correct bill quantity / price** on a line
with an exact PO source. Its form shows the PO price and received quantity,
retains reviewed bill values, and uses the existing typed command transport.
Both Accounting and Purchasing queries invalidate afterward. The action remains
unavailable with a contract package lacking the new economic fields.

## Bounded scope

The first path supports untaxed, undiscounted bills in the company currency with
one payable line. Tax, foreign-currency, reconciliation and ambiguous legacy
economics require subsequent work. No matching tolerance is widened. Price
variance still blocks posting until corrected. This does not import all
posting/provenance changes from companion PR #178.

## Verification ledger

- Four correction eligibility/parameter tests and twelve existing invoice-action/Purchasing recovery tests passed.
- Web type checks passed against both the current pin and the generated companion candidate.
- Final producer native compile passed. A schema-extraction WASM build passed before the final company-access guard; no final deployed-runtime pass is claimed.
- SpacetimeDB 2.8.2 generated both SDKs. Clean canonical IR pins producer `09812db2ad18e8ad4dcbbb84a9520285798dd095`, with 1,427 operations, 364 resources, 504 tables and 1,364 types.
- Contract generator/drift check, 30 Python tests, TypeScript package build/tests, two SDK binary round trips and Rust all-feature compile passed.
- Playwright discovery found four procure-to-pay scenarios plus authentication setup; no scenario executed.
- Expanded Purchasing price-match reducer regression: authored, not run.
- Operator-browser price correction/rejection/recovery scenario: authored, not
  run. It follows exact producer-owned IDs and checks balance, totals, Draft
  rejection, reviewed price after navigation and same-bill posting.
- Full-stack acceptance remains deferred by user request.

The application now pins immutable contracts `v0.3.102`, commit
`ee3994efd6c36229cb656306ddde996a6e7c0d7b`, in Rust, all frontend consumers,
both lockfiles and the release compatibility manifest. The release comes from
the reviewed v0.3.92-compatible branch; newer contract main history was preserved.

Contract companion: [lumiere-contracts #19](https://github.com/KevTiv/lumiere-contracts/pull/19), released as v0.3.102. The reviewed fields invalidate stale edits; changed approval snapshots require fresh review rather than reuse.

## Local activation evidence

- Final source built as development WASM with development seeding enabled, then
  published to local module `lumiere-cov05-local` at `http://127.0.0.1:3185`.
  Live schema inspection confirms all four correction fields.
- Published module WASM SHA-256: `e770802b6c47b7dda0a26b8f2361204a36399efa9eacc442541f13e046665f4f`.
- Frozen frontend installation and Rust dependency resolution use the released
  commit. Installed `accountingBillCorrectionAvailable()` returns true.
- Web TypeScript check, final API binary build, release compatibility verifier
  and diff whitespace check passed against the real release pin.
- Local demo initialization succeeded. PostgreSQL 17.11 runs on loopback port
  55432; the application migration runner completed through migration 11.
- API `http://127.0.0.1:8082/ready` returns 200/ready, reports contract release
  0.3.102 and migration 11, and marks SpacetimeDB, PostgreSQL, migration and
  release compatibility healthy.
- `http://localhost:3100/accounting` and `/purchasing` return 200; authenticated
  `/api/query/account-moves` returns six demo rows.

Services remain running. Local connection settings/credentials are kept in
ignored `.tmp/cov05-activation/env.sh`; logs and the readiness report are in the
same directory. The module uses a dedicated local data directory. This is local
activation evidence, not the deferred multi-actor business acceptance run or a
projection convergence certification. Exact source lineage still gates the
action, so it is offered for eligible newly generated PO bills, without guessed
legacy backfill.
