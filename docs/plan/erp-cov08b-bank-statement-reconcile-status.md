# COV-08b — exact bank-statement reconciliation

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov08b-bank-statement-reconcile`  
**Stack base:** COV-08a / `codex/cov08a-invoice-payment-reconcile`

## Bounded path

One open bank-statement line is reconciled to one exact company-scoped journal
item through the existing Accounting bank-statement dialog. The reducer now
requires the line, parent statement, journal relation, and every selected move
line to share the caller's organization and company. It also rejects posted
statements, empty or duplicate move-line sets, and negative or non-finite
residuals before mutation.

Canonical UI readback requires the exact line ID, its exact parent statement,
organization/company scope, Open parent state, exact order-independent move-line
ID set, expected residual, and matching reconciled disposition. Duplicate exact
records fail closed.

## Contract disposition

**Generated contract delta: none.** This PR uses the existing
`reconcile_account_bank_statement_line` parameters and the existing
`bank-statements` / `bank-statement-lines` projections. It changes validation
and readback behavior without changing a generated shape.

## D/A/O/E proof

| Gate | Proof in this PR | Acceptance condition |
| --- | --- | --- |
| D | Accounting persisted test creates a statement and line, reconciles to one exact receivable line, rejects replay, and proves unchanged ID set/residual/timestamp. | Native Accounting suite passes. |
| A | Reducer validates organization/company on line, parent and every journal item; existing permission check remains first. | Writer succeeds once; cross-tenant/read-only calls reject before mutation. |
| O | `cov08b-bank-statement-reconcile.spec.ts` opens the statement record, focuses its line, and submits the visible manual-reconcile form. | Focused Playwright path passes. |
| E | Hook and unit test require the same line/statement IDs and exact move-line set; browser proof requires 422 replay, 403 denial and unchanged readback. | Unit, native and browser evidence is green on one head. |

## Accepted-plan statement

COV-08b becomes **ACCEPTED** only after same-head contract generation produces
no diff, query-hooks unit/typecheck passes, native Accounting tests pass, the
focused browser test proves operator transition plus stale/deny preservation,
and stacked PR CI is green. Until then its status remains **IMPLEMENTED —
runtime acceptance pending**.
