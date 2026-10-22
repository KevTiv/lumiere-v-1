# Finance review workspace

Base: main at `7d03fe78`, including merged #243.
Branch: `codex/finance-review-workspace`.

## Scope

- Use one shared review layout for invoice and bill creation, expense capture, saved accounting records, and saved expense lines.
- Keep the editor and selected file mounted when users change the review view.
- Offer side-by-side review on wide screens and stacked or separate views on small screens. Keep draft save controls outside the scrolling body.
- Show saved source files through authenticated blob reads. Require the exact organization, company, and record relation. For bills, require one explicit current version. For expenses, use the saved receipt IDs and employee relation.
- Keep source-query failure, inaccessible evidence, and an available source distinct. Existing document owner and version creator read policies still apply. No access rules are broadened.
- Show task rows in the Finance work queue. Put nonzero counts first. Count queues needing attention, rather than adding different record types. Keep unavailable counts distinct from zero. Use the active company and state that counts are independent of the dashboard date range.
- Offer comfortable and compact table rows. Store each list's choice in the browser. Preserve selection and filters. Use aligned money columns and tabular numbers.
- Keep the command palette title and description inside the active dialog so assistive technology can identify the desktop palette. This defect was exposed by the existing Finance navigation browser check.
- Decode nullable document company and current-version IDs through the existing server decoder. This fixes an evidence-ingestion scope check without changing permissions or contracts.

## Boundaries

This batch does not add a reconciliation desk, approval rules, OCR service, or server draft recovery. Existing action handlers and server confirmation remain authoritative. Preview input is not proof of a saved or posted record. Uploaded image files remain reviewable when OCR is unavailable; text indexing can still report that no OCR result is configured. PDF preview uses the browser's PDF support and provides an authenticated download link.

The live Alpha deployment is unchanged. This branch is a separate review unit after PR #243. Local checks do not certify the full Finance domain or replace exact-head CI and review.

## Earlier isolated validation

The production frontend build, API build, both frontend type checks, new-file lint checks, translation checks, the opaque-record ratchet, the operation-transport check, Rust formatting, and diff checks pass. The focused tests pass: 34 UI tests, 5 source-boundary tests, and 5 API evidence tests. All 35 browser checks pass, including authentication setup, Finance authoring, receipt capture, desktop and mobile navigation, the new workspace, density persistence, and Overview. The final run passes without retries. Browser checks use a production frontend build, the isolated `lumiere-v1-finance239-e2e` module, and the existing isolated PostgreSQL database. They do not reset data or publish to the live deployment.

The PDF browser check verifies authenticated delivery and a correctly typed native viewer with fallback. It does not certify each browser PDF renderer. PNG checks verify that the saved image bytes load.

## Current-main integration

The invoice/bill creation modal now mounts the shared review workspace around its actual editor and document preview. This closes the missing integration exposed by hosted CI. Its draft fields remain mounted through view changes, the existing preview control locator is retained on the preview tab, and save/recovery controls remain outside the scrolling body. The browser check targets the actual `invoice-document` preview. The table merge retains both row density and main's width/overflow constraints.

UI and web pin the same Zod 3.25.76 package, preserving a single schema identity at the form resolver boundary. Frozen offline installation succeeds with a lockfile change confined to Zod. Density preferences write only after an explicit choice; blocked storage leaves the choice in memory and initial rendering makes no preference writes.

Current local checks: 943 UI tests across 147 files, five source-boundary tests, UI and web TypeScript, changed UI lint, workflow YAML and the required-test runner checks pass. Playwright discovers seven review-workspace scenarios plus authentication setup. CI now executes the API evidence-ingestion tests, including nullable document scope/version decoding, through the nonempty test-selector runner. Full hosted browser and native CI remain required before merge; the earlier isolated browser run does not certify this integrated head.

The saved invoice/bill overview also uses the shared workspace: its ERP document and record details stay in one mounted pane, and its exact authorized source is the other pane. The existing invoice/bill authoring browser cases explicitly select the Document preview and Edit document tabs and require the quantity input to be visible before editing. Local web TypeScript, all five source-boundary tests and discovery of the 25 combined authoring/review tests pass. Hosted run `39757154155` passed the new-draft review cases and all non-E2E gates; the saved-record integration and authoring-tab follow-up still require a fresh full hosted run.
