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

## Wave 2 acceptance evidence (2026-10-13)

**State:** IMPLEMENTED in the `codex/cov-u5-closure-wave2` working tree; not yet
accepted on an immutable head.

Payment cancellation now treats reconciliation as an owned, reversible effect.
`unregister_payment_allocations` validates permission, organization/company,
Posted state, open period, and matching identity before mutation; restores the
invoice/bill and payment-line residuals plus linked sales-order totals; clears
the payment's reconciliation references; and rejects replay or a line subsequently
owned by another payment. `cancel_payment` performs that unwind and the exact
posted journal reversal atomically, so a reconciled payment cannot be cancelled
while leaving a settled invoice behind.

The reducer harness now includes
`test_reconciled_payment_unwind_and_cancel_exact_effect` for signed residual and
line-identity restoration, organization/company denial, permission denial,
replay preservation, and one exact reversal, plus
`test_payment_allocation_unwind_blocked_in_closed_period` for closed-period
unregister/cancel rejection with unchanged payment, invoice, and line snapshots.
The existing `test_cancel_payment_audited` continues to prove exact debit/credit
inversion and duplicate-cancel rejection. All cases are wired into the Accounting
aggregate reducers. `cargo check --lib` completed successfully on this working
tree (warnings only), and `git diff --check` passed for the four Accounting files.

Remaining acceptance blockers are explicit:

1. Run and persist the Accounting reducer harness on the immutable current head;
   compilation alone is not runtime acceptance, and these Wave 2 cases have not
   yet been published/executed against a clean SpacetimeDB target.
2. Add an operator-visible cancel/unwind action and focused Playwright proof for
   exact residual restoration, one reversal, stale replay, reader denial, and
   unchanged canonical snapshots. The existing browser path proves registration,
   not cancellation, and `unregister_payment_allocations` has no generated
   frontend command binding yet. If that explicit reducer is exposed, regenerate,
   release, and pin its contract delta first.
3. Record same-head CI and browser evidence. The current implementation is an
   uncommitted working-tree delta over head `9bdf9a9d5bcd`, not a certifiable
   current-head artifact.
4. Program-level U5 remains gated by COV-26 and COV-27: COV-26 is still REVIEW
   with public hosted-application certification deferred, while COV-27 remains
   SCAFFOLDED with its all-module launch manifest and ratchets unimplemented.
