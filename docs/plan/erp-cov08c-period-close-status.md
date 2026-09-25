# COV-08c — exact accounting period close

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov08c-period-close`  
**Stack base:** COV-08b / `codex/cov08b-bank-statement-reconcile`

## Bounded path

An Accounting operator selects one Open period and closes it through the
existing Account Periods bulk action. The mutation now returns only after the
same organization/company/period ID reads back as Closed; duplicate exact rows
fail closed. Existing posting enforcement rejects invoices and payments dated
inside the closed period.

## Contract disposition

**Generated contract delta: none.** `close_account_period` and the
`account-periods` projection already contain the required operation, identity,
scope and state fields.

## D/A/O/E proof

| Gate | Proof in this PR | Acceptance condition |
| --- | --- | --- |
| D | Persisted period-lock tests close the exact period, reject replay without changing state/timestamp, and reject invoice/payment posting inside it. | Native period-lock suite passes. |
| A | Existing generated close operation retains permission and organization/company scope checks. | Writer succeeds once; reader receives 403. |
| O | `cov08c-period-close.spec.ts` creates an isolated calendar, selects its exact Open period, and clicks the visible Close period action. | Focused browser path passes. |
| E | Hook resolves only the same scoped ID in Closed state; unit test covers state/scope/ambiguity, and browser proof preserves the snapshot after 422 replay and 403 denial. | Unit, native and browser proof is green on one head. |

## Accepted-plan statement

COV-08c becomes **ACCEPTED** only when contract generation has an empty diff,
query-hooks unit/typecheck passes, native period-lock tests pass, focused
Playwright proves close/replay/denial, and stacked PR CI is green on the same
head. Until then it remains **IMPLEMENTED — runtime acceptance pending**.
