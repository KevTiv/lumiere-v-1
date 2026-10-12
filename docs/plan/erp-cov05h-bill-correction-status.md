# COV-05h Bill economic correction and price recovery

**Disposition:** `IMPLEMENTED` — paired draft contracts; release pin and acceptance pending.

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

The application consumes v0.3.92. Its generated candidate must not replace the
newer v0.3.100 contract history on main. Review contracts and producer source
together, then integrate the compatible immutable contract before rollout.

Contract companion: [lumiere-contracts #19](https://github.com/KevTiv/lumiere-contracts/pull/19), commit `e91e5d6`, based on an exact v0.3.92 release-line branch. No newer contract main history was rewritten. Package version and application pins remain unchanged pending integration/release. The two fields with reviewed values invalidate stale edits; changed approval snapshots require fresh review rather than reuse.
