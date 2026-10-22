# Finance workflow tools

Status: REVIEW. Seven bounded workflow changes extend the authoring previews and input cleanup in PRs #239 and #240. This work does not certify Accounting, Expenses, or Reports as U4/U5.

## Scope

| Area | Implemented tool | Completion rule and limit |
| --- | --- | --- |
| Bank statement import | File selection, local row validation, estimated balances, and separate Review/Stage actions | Staging requires an unchanged reviewed file and setup. Confirmation checks the exact request key, scope, header, and all saved rows. Staging does not approve or reconcile a statement. |
| Payment allocation | Named open items, available payment balance, residual estimates, and optional write-off inputs | Confirmation checks the owner-enforced active payment/item relation, currencies, amounts, write-off account, reversals, and residual arithmetic. Missing or conflicting data blocks submission. |
| Expense capture | Image/PDF preview, real blob upload, receipt registration, durable request checkpoints, status checks, and explicit rejected-request retry | Confirmation checks the exact request key, submitted expense values, and receipt relation. Unknown outcomes permit readback only. Unuploaded file bytes remain in the mounted panel; after reload the original file must be reattached. No synthetic storage reference or fallback mutation is used. |
| Asset depreciation | Exact saved schedule with dates, installments, cumulative depreciation, and remaining value | The existing owner generates the board. A server fix advances calendar months and sums actual installments. Existing saved boards are not recalculated. There is no authoritative pre-save calculation endpoint. |
| Period close | Current company/period review, exact draft-entry and bank-line links, and a close consequences dialog | Uses the existing period-close operation and exact period readback. Checklist items remain advisory; this UI does not invent a new server close policy. |
| Report templates | Heading/text/table sections, column order, raw markup, paper/orientation defaults, and a sandboxed preview | Existing custom markup requires explicit replacement in the draft. Example rows are never saved. Exact-ID readback checks all edited fields. Live data binding remains the report integration's responsibility. The preflight conflict check is not an atomic server compare-and-set. |
| Accounting navigation | Task-area selection, direct-tab links, and compact setup guidance | Uses existing tabs and permission checks. Setup expands for a blocked action. Navigation clears record filters when changing tabs. |

## Authority and readback

Existing generated operations, trusted API routes, and reducer owners remain authoritative. No schema, reducer signature, or pinned generated contract is edited. Source query policies expose only the existing fields required for these tools. Relation arrays are explicitly allowed for the relevant resources and still pass through field-access filtering. Payment-account reads retain the projected archive field after excluding archived rows, as required by the existing typed codec.

Named parameter serialization now handles nested statement-import row options and report-template optional fields. Receipt upload refuses company IDs that the current numeric upload boundary cannot represent exactly. HTTP query responses preserve unsafe i64 timestamp values as decimal strings, as permitted by the existing codec. Safe timestamps, scalar IDs, financial amounts, and metadata are unchanged. This keeps accepted future fiscal periods readable without weakening the typed decoder.

All ambiguous writes preserve the submitted request for an exact status check. An HTTP success alone is not shown as a confirmed financial result. A definite capture rejection has a separate durable state and requires an explicit retry. Legacy outbox entries that lack safe checkpoints cannot be resumed as new writes.

## Verification

Final integrated results are recorded below after execution. Unit, component, static, owner, and browser results are separate evidence. Draft PR status and green CI are not module certification.

- Focused workflow model tests: 51 passed. Focused component/navigation tests: 82 passed. Named parameter/command codec tests: 57 passed.
- Source registry/field-policy tests: 62 passed. API query-boundary tests: six passed (archive handling and exact timestamp serialization).
- Native owner depreciation tests: four passed.
- Isolated local owner suite: existing fixed-asset ownership reducer completed after the rebuilt module was published without deleting data.
- Report layout browser save/readback/reload/restore: passed.
- Final production frontend build, UI/web type checks, translations, opaque-record ratchet, and browser transport checks: passed.
- Final authenticated production browser run: all 31 tests passed (30 workflow cases plus authentication). This includes real import staging, payment allocation, PNG/PDF upload/capture, saved schedule generation, period close, report layout save/reload/restore, offline recovery, narrow layouts, and keyboard/filter navigation.
- `make check-codegen-pinned` passed. The actual typed decoder accepted all future-period rows and preserved exact signed i64 microseconds.
- Exact-head CI: pending on the draft PR stack. Foundation PR: #241; the companion UI PR is based on it.

The local lane uses module `lumiere-v1-finance239-e2e`, PostgreSQL database `lumiere_finance239_e2e`, API port 48083, and web port 4317. Receipt bytes use a dedicated temporary blob directory. No live Alpha data or deployment is changed.

## Workflow evidence card

Task / base SHA: Finance workflow tools, based on `d258bb7d3bc5ff3acb0a50471d05c329d020036b` (PR #240). Existing COV-08/COV-11 levels are not promoted by this slice.

Files changed: the companion PR diffs enumerate the source, focused tests, source read policies, and this status note.

Before path: ordinary field forms or incomplete capture metadata gave limited review feedback. Asset and close workspaces did not present the full saved result or consequences.

After path and canonical owners reused:

| Workflow | Concrete authority path | Effect identity and cardinality | Resulting record ref |
| --- | --- | --- | --- |
| Statement staging | `payment-operations-panel.tsx` → `useStageBankStatementImport` → generated `stage_bank_statement_import` → trusted API operation dispatch → existing Accounting import owner → import workspace readback | One company/request-key header with matching journal, currency, file, opening balance, and full row set | `bank-statement-imports` / exact header ID |
| Allocation | `payment-operations-panel.tsx` → `useAllocatePaymentTransaction` → generated `allocate_payment_transaction` → trusted API dispatch → existing Accounting payment owner → reconciliation/line readback | Zero or one active transaction/move-line relation after exact reversals; duplicate or inconsistent economics fail closed | `payment-reconciliations` / exact reconciliation ID |
| Capture | `expenses-capture-panel.tsx` → `expense-capture-sync.ts` → existing blob service, receipt registration, and `useCreateExpense` → generated operations → trusted server → `hr/expenses.rs` → exact readback | Zero or one expense/receipt per immutable request key and scope; compare submitted fields and attachment IDs | `expenses` / exact expense ID and `expense-receipts` / exact receipt ID |
| Schedule | `AssetDepreciationSchedule` → existing `useComputeDepreciationBoard` → generated `compute_depreciation_board` → trusted server → `accounting/fixed_assets.rs` → saved board and explicit query refresh | Exact asset ID, owner board IDs, company, and one saved line per sequence | `account-assets` / selected asset ID and exact `depreciation-lines` IDs |
| Close | `PeriodCloseChecklist` → existing `useCloseAccountPeriod` → generated `close_account_period` → trusted server → existing Accounting fiscal-period owner → `resolveClosedPeriodEffect` and explicit query refresh | One exact organization/company/period ID with Closed state | `account-periods` / selected period ID |
| Template | `TemplateLayoutEditor` → `useUpdateReportTemplate` → generated `update_report_template` → trusted server → existing analytics report-template owner → `resolveReportTemplateUpdate` | One exact organization/company/template ID with all edited fields equal | `report-templates` / selected template ID |
| Navigation | `ModuleView` → existing `useModuleTab` → current URL | No write or business effect | Existing tab and optional record-filter URL |

Typed outcomes/errors: named operation decoding preserves definite rejection and ambiguous dispatch. Canonical readback rejects unavailable, foreign-scope, duplicate, or conflicting results. UI drafts and submitted request identities stay available when confirmation fails.

Tests run (command + result): see Verification above and the PR validation sections. Browser cases perform the actual operator transition; fixture owner calls only establish setup dependencies.

Operator proof: real statement staging, allocation, receipt upload/create, board generation, period close, template save/reload/restore, and keyboard navigation are covered by the added Finance Playwright specs. Final run status is recorded above.

Compatibility/debt retired: synthetic capture storage references, fallback double dispatch, nested import Option serialization failure, missing archive proof, stale saved-result views, hidden tab keyboard targets, and stale record filters.

Remaining blocker/deferral: exact-head CI and the limits in the scope table. Full cross-module certification, atomic template compare-and-set, a pre-save owner depreciation preview, historical board migration, and durable pending file bytes remain outside this slice.

Contract release required: no schema or operation signature change. The Rust-owned read registry and source field policy are changed, then regenerated and compiled. Pinned generated contracts remain unchanged.

Next bounded task: exact-head CI/review for the dependency-ordered PRs; separate owner/contract work for the deferred capabilities when selected.
