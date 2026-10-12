# Purchasing stack integration

Date: 2026-10-12 (Europe/Amsterdam). Integration lane: PR #179.

## Integrated source

- Receipt recovery from #176, original commit `16f87f9ffc5be5fb18dcde6b184c344a56c52665`.
- Received-based partial billing and strict provenance from #178, original commit
  `5291de49b05be67c0cd1df023d369a0400e31d82`.
- Upstream procurement, approval controls, quantity recovery, and draft bill
  economic correction already in #179 at `3ce067c3`.

The two Purchasing commits are cherry-picked onto #179. Their unrelated #150
subscription ancestry is excluded. #176/#178 remain unchanged for historical
review; their source is included here, not dependent on merging their older stack.

## Resolved overlaps

Bill creation inserts the exact bill-line ID once into its source PO line's
`invoice_lines`, preserving links from earlier partial bills. Remaining billable
quantity is received minus invoiced, rather than ordered minus invoiced.

Receipt, PO billing, and economic correction all call Purchasing's shared
received-based invoice-status owner. A later receipt reopens Partial coverage;
ordered fulfillment remains the separate receipt status. Correction preserves
atomic line/payable amounts, totals, PO quantity and match updates.

Strict provenance is enforced before approval dispatch and at actual posting,
including direct Accounting posting and approval re-entry. Missing, duplicate,
dangling or foreign lineage fails closed without guessed legacy backfill.
The new native fixture uses the four released correction fields explicitly as None
when it exercises ordinary debit/credit editing.

## Contracts and runtime boundary

The pinned release remains `lumiere-contracts` v0.3.102 (contracts PR #19).
Integration changes implementations and tests, not public reducer signatures,
tables or generated codecs. The bounded correction command and its canonical
readback fields are released; earlier documents' repository-attachment and
missing-correction-codec statements describe their original investigation base.

Localhost was activated at the earlier #179 head with v0.3.102. The new integrated
backend has not been republished to that module. Next.js reads current source;
this does not establish a matching live backend or certify integrated behavior.
Historical #176 browser passes apply to its recorded source only.

## Validation

- Native `cargo check --locked --offline --manifest-path spacetimedb/Cargo.toml --lib`
  passed, including the in-module Purchasing regression fixtures. Existing
  warnings remain. The reducer fixtures were compiled, not executed.
- ERP workflow suite and query-hook suite passed (22 and 57 test-file processes).
- Direct focused runs passed 49 cases: ambiguous dispatch (7), Purchasing
  transitions (17), receipt evidence (15), bill correction (4), quantity recovery (6).
- Web, workflow and query-hook TypeScript checks passed.
- Four Purchasing/Accounting web test-file processes passed.
- Playwright discovery passed: 11 cases across six files; discovery is not execution.
- v0.3.102 release-manifest verification and `git diff --check` passed.

Full operator acceptance remains explicitly deferred.

## Still required

- A fresh integrated runtime setup and Purchasing acceptance run covering partial
  receipts/two bills, response loss, strict posting, approvals and bill correction.
- Durable invocation identity/replay for partial receipt operations and exact
  PO creation-key result ownership for concurrent custom-field attachment.
- Broader draft correction now supports existing discounts, explicit percentage-tax
  rows and consistent FX evidence: [COV-05i](erp-cov05i-broader-bill-correction-status.md).
  Reconciled/posted bills, unsupported tax structures and historical missing lineage
  remain outside correction support.
  [COV-05j](erp-cov05j-tax-fx-bill-creation-status.md) adds explicit tax selection and
  canonical tax/FX bill production to the same integration lane.
- Remote CI and review. This integration does not mark Purchasing accepted.
