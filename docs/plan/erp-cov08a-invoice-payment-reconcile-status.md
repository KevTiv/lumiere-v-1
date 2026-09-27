# COV-08a — exact invoice/payment reconciliation

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov08a-invoice-payment-reconcile`  
**Stack base:** COV-07g / `codex/cov07g-bom-byproduct-output`

## Bounded path

One posted payment move is reconciled with one posted invoice move through the
existing Accounting reconcile form and the versioned
`reconcile_payment_with_invoice` operation. Canonical readback now requires the
exact two move IDs, one company, Posted state on both records, a Paid or Partial
invoice payment state, and finite nonnegative residuals. Duplicate exact IDs are
an invariant failure rather than a row-selection opportunity.

The reducer now rejects a replay before mutation when either the invoice has no
residual left or the payment is already fully applied. This prevents a stale
request from rewriting matching metadata, timestamps, sale totals, or audit
history.

## Contract disposition

**Generated contract delta: none.** The reducer operation and both
`account-moves` readback fields are already present in the pinned generated
contracts. This slice changes reducer semantics and observation only; it adds no
table, reducer, parameter, or resource shape. Contract generation must therefore
produce an empty diff for this PR.

## D/A/O/E proof

| Gate | Proof in this PR | Acceptance condition |
| --- | --- | --- |
| D — domain | `test_payment_reconciles_invoice` snapshots both moves and every affected move line, replays the exact reconcile command, requires rejection, and compares the full snapshot. | Persisted native suite passes. |
| A — authenticated operation | Existing generated `reconcile_payment_with_invoice` command remains the only write boundary; permission check runs before stale-state checks. | Writer receives success once; reader receives 403. |
| O — operator transition | `accounting-post-reconcile.spec.ts` selects the exact payment and invoice in the Accounting reconcile form. | Browser run submits through the visible form and closes it after success. |
| E — exact effect | Workflow observer reads the exact payment/invoice IDs; browser proof requires invoice Paid with zero residual, replay 422, denial 403, and unchanged two-move snapshot. | Focused unit, native, and browser proofs pass on the PR head. |

## Accepted-plan statement

COV-08a becomes **ACCEPTED** only when the PR head records all of the following:

1. contract generation completes with no generated diff;
2. query-hooks focused unit tests and typecheck pass;
3. persisted Accounting native tests pass;
4. the focused Accounting Playwright path passes with exact readback, stale
   replay, read-only denial, and no mutation after either rejected request;
5. the stacked PR CI is green.

Until those artifacts exist on the same PR head, the truthful disposition is
**IMPLEMENTED — runtime acceptance pending**.
