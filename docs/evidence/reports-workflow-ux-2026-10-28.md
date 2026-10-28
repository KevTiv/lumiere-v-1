# Reports workflow usability

Date: 2026-10-28. Local implementation and focused verification; no deployment or live-user acceptance claim.

## Baseline

The provided checkout starts at `fb7f6687cfa71d91f2c2377a9d32a585f8ade05e` (Alpha UX sweep, PR #285). A read-only Railway check found web deployment `e4b258f2-8cc8-4990-b0a8-aad51b2e6f93` successful at `a38badfce40a55fa9bf2302135070370784f6ac5` (PR #292). Deployment history confirms the earlier Reports form cleanup had shipped. The publication commit is based on current main `23bb5c942bf0f4416fa373bc24e49c0cedaa4370` (PR #291). GitHub comparison confirmed that only the CI workflow and translations overlap with the Reports patch; both were merged cleanly. All other newer main files are inherited unchanged. Local runtime checks used the supplied checkout; hosted CI verifies the integrated branch.

## Changes

- Reports starts with a report catalog and the existing generation form, with the chosen type preselected. The reporting overview remains available under a disclosure. A period-close launch offers only its locked trial balance; its existing submit owner still reapplies exact period values.
- Workspace labels name Run a report, Saved reports, Dashboards and Schedules. Templates, metrics, widget authoring and the query builder remain reachable under Advanced. Canonical tab identifiers and existing routes are retained.
- The creation hook returns the exact identity only after canonical generation readback. Both create entry points open that result. Existing request correlation and protection against duplicate dispatch on uncertain generation remain authoritative.
- Saved report names and Open report open a URL-addressable result. Selection requires one exact ID in the operating organization/company and any locked period. Missing, loading, denied and failed sources never select a substitute report.
- Results keep company, period, result currency, accounting basis and comparison alongside output and permitted export/regeneration actions. Statements use their existing viewer; other supported financial reports show their saved account totals. Unavailable currency codes do not become the operating company's currency.
- Report currency is visibly required, matching the existing parameter validator. Recording a schedule run is labelled Record completed run.
- Already-exported reports use the existing download endpoint without replaying export registration. Download verification checks the exact report, scope and exportable state first. Unsupported numeric identities fail before dispatch rather than being rounded for the existing download API.

## Design evidence

The references inform structure within the existing Lumiere components, fonts, tokens and themes; they do not establish measured adoption gains.

| Decision | Inspected example |
| --- | --- |
| Direct access to named financial reports | [Mercury](https://mobbin.com/screens/86d1b223-4450-4f3e-ac66-72a05f9a8ea3) groups Balance Sheet, Profit & Loss, Cash Flow Analysis and General Ledger under Reports. |
| Report context and actions beside output | [QuickBooks](https://mobbin.com/screens/fddfd2a4-1b8c-45a8-933f-e8f639294b66) shows the report period, accounting method, comparison and output controls with the statement. [Quicken](https://mobbin.com/screens/c6beb86c-33df-413a-9be4-93aa6dbec8f7) keeps date selection in the report workspace. |

The before/after artifacts in `/workspace/scratch/reports-redesign` are labelled synthetic previews of production UI components. Their session-storage saves and example amounts are not backend or deployed financial evidence.

## Verification

- Reports model: 4 passed; shared workspace model: 8 passed; statement tree: 12 passed; authoring preview model: 4 passed.
- Hook, form and period-context checks: 16 passed, including exact creation readback, uncertain-generation retry, export download without a repeated registration write, and company/state rejection.
- Existing creation-effect and archive regressions: 3 passed each.
- Reports browser suite: 6 passed at 390x844 and 1440x900. Covers type preselection, retained rejected entries, exact-result routing, reload/reopen/return, output-local actions, unavailable sources and recovery, locked catalogs, reader access, and horizontal containment. The fixture makes no ERP API calls.
- Shared navigation: helper check and workspace/history/overflow/keyboard/touch checks passed at 320, 390, 768 and 1440px. The first 320px assertion followed a live ordinal link locator after responsive navigation moved links; the test now snapshots stable workspace IDs. The corrected 320px case passed separately; the other four cases passed in the initial run.
- Web TypeScript, changed-source lint, static i18n key check and diff whitespace check passed. Browser and model tests are registered in the existing frontend CI workflow.

Commands: `pnpm --dir frontend/web test:e2e:reports-ui`; UI Vitest for `report-generation-hook`, `reports-form-inputs`, and `period-report-context`; web `tsc --noEmit`; direct Node/tsx runs of the model files. Logs remain under `/tmp/reports-*` in this execution environment.

## Release follow-up

Run hosted CI and authenticated saved-result/download checks against an isolated backend, then observe representative Alpha users generating, understanding, downloading and reopening a report. Record task completion, time to first correct report, and failed/repeated actions. Deployment and that live-user validation have not been performed here.
