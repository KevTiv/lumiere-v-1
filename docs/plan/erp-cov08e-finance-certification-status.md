# COV-08e — Finance module certification over 08a–d

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov08e-finance-certification`  
**Stack base:** `codex/cov08d2-asset-depreciation-disposal`  
**Module/surface:** Accounting / Finance  
**Plan target:** COV-08 certification

## Bounded path

COV-08e closes the Finance sequence with one visible
`Exported → Archived` financial-report transition while retaining the
same-head COV-08a–d proofs from the stacked branch.

Operator surface: `/reports` → Financial reports.

- `archive_financial_report` remains the write boundary.
- Canonical readback is the same `financial-reports.id`, organization and
  company in `Archived` state.
- No newest-row, name or timestamp correlation is permitted.

## Implementation

- `useArchiveFinancialReport` now uses
  `executeOperationWithCanonicalReadback` and returns only after the exact
  scoped report reads back as Archived.
- `resolveArchivedFinancialReportEffect` fails closed on identity, scope,
  state and duplicate-row ambiguity.
- The persisted trial-balance lifecycle now continues through archive, rejects
  wrong-company archive and stale archive replay, and proves both leave the
  canonical report unchanged.
- The COV-08e browser proof creates/generates/exports fixture data via trusted
  setup calls, then drives Archive through the visible Reports UI and preserves
  the exact snapshot after 422 stale replay and 403 reader denial.

## Contract disposition

**Generated contract delta: none expected.** `financial-reports` already
projects `id`, `organization_id`, `company_id` and `state`, and
`archive_financial_report` already has the required session operation shape.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | `test_trial_balance_summary_balances` now certifies Generate → Export → Archive, wrong-company rejection, stale archive rejection and unchanged canonical row/audit count. | `run_all_accounting_tests` passes. |
| A | Existing `financial_report:write` permission remains first; reducer validates organization/company. Browser replay as `fixture.reader` requires 403. | Writer succeeds once; reader and wrong company fail without mutation. |
| O | `cov08e-finance-certification.spec.ts` drives the visible **Archive** action in `/reports` → Financial reports. | Focused Playwright proof passes. |
| E | `reports-financial-archive.test.ts` covers exact identity/scope/state and ambiguity; browser proof requires the same report snapshot after 422 and 403. | Unit/native/browser evidence green on one head. |

## Finance certification statement

COV-08e certifies the bounded COV-08 sequence only when the same stacked head
has green evidence for COV-08a, 08b, 08c, 08d/08d2 and this archive proof.
Existing green evidence is not rewritten as accepted merely because this
follow-on branch contains it.

Until `run_all_accounting_tests`, the focused COV-08 browser lane and branch
CI pass on this head, the truthful disposition is **IMPLEMENTED — runtime
acceptance pending**.
