# COV-08d — exact fixed-asset confirm and close

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `claude/cov08d-asset-lifecycle`  
**Stack base:** COV-08c / `codex/cov08c-period-close`

## Bounded path

An Accounting operator selects one Draft fixed asset and confirms it through
the existing Fixed Assets **Confirm selected** action, then closes the same
asset through **Close selected**. Each mutation returns only after the same
company-scoped asset ID reads back in the expected state (`Running`, then
`Close`); duplicate exact rows fail closed.

Defect retired: the Close action filtered on an `"Open"` asset state that
`AssetState` (`Draft | Running | Close | Removed`) never produces, so clicking
it on a running asset silently dispatched nothing (COV-00C false-success class).
It now dispatches for `Running` assets.

## Contract disposition

**Generated contract delta: none.** `confirm_account_asset`,
`close_account_asset` and the `account-assets` projection (`id`, `company_id`,
`state`, `code`) already carry the required operation, identity, scope and
state fields. The projection has no `organization_id`; the query route scopes
rows to the session organization, so company + id + state is the stable key.

## D/A/O/E proof

| Gate | Proof in this PR | Acceptance condition |
| --- | --- | --- |
| D | `fixed_assets_test.rs` confirms one asset, then proves a confirm replay is rejected ("Draft state") without changing state or `write_date`. | Native accounting suite passes. |
| A | Existing generated confirm/close operations keep `account_asset:write` permission and organization/company scope checks. | Writer succeeds; `fixture.reader` receives 403. |
| O | `cov08d-asset-lifecycle.spec.ts` creates an isolated Draft asset (setup only), then drives Confirm and Close through the Fixed Assets tab. | Focused browser path passes. |
| E | `resolveAccountAssetStateEffect` resolves only the same scoped ID in the expected state; unit test covers state/scope/identity mismatch and ambiguity; browser proof preserves the snapshot after 422 replay of both transitions and a 403 denied replay. | Unit, native and browser proof green on one head. |

## Accepted-plan statement

COV-08d becomes **ACCEPTED** only when contract generation has an empty diff,
query-hooks unit/typecheck passes, the native accounting suite passes, the
focused Playwright proof passes, and CI is green on the same head. Until then it
remains **IMPLEMENTED — runtime acceptance pending**.

Deferred to later COV-08d slices: depreciation-board computation/posting and
disposal (`dispose_account_asset`) exact-effect proof.
