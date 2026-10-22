# Finance input cleanup

Status: REVIEW. Bounded input and dialog changes on top of the Finance authoring previews in PR #239. This work does not certify Accounting, Expenses, or Reports as U4/U5.

## Scope

| Area | Change | Limit |
| --- | --- | --- |
| Reconciliation widgets | Searchable account and partner choices; named journal-item selection and removal; Bank/Manual mode choices; visible unavailable selections | Choices require the current organization/company/account/partner. Submission rechecks the loaded records. Existing widgets can retain or clear an empty item list. An existing legacy mode can be retained only on its own record. |
| Expense capture | Standard, Mileage, and PerDiem show only their inputs; project/product choices and tax multiselect replace manual IDs | Product expense eligibility remains server validation because the current catalog projection lacks policy fields. The update contract does not support editing project or clearing an existing product. |
| Expense receipts | Register metadata only from a completed upload; append new edit receipts; retain upload/request/receipt identity across explicit retries | The cache lives in the mounted component and uses the File object plus exact organization/company/employee scope. It is not durable recovery after a reload. The separate offline capture panel is unchanged. |
| Expense finance actions | Show errors inline and reject failed submissions; keep the dialog and edited values open | Existing operation hooks and result resolution remain the owners. |
| Fixed assets | Show the factor for degressive methods; disclose optional disposal accounts; retain existing choices when collapsed | The existing asset mapper decides which method values are sent. No depreciation calculation is added. |
| Report templates/schedules | Business source preset with an advanced custom source; numeric margins in mm; explicit action labels; supported frequencies only | Only the proven account.move source is a preset. Custom identifiers remain supported. The existing scheduler accepts Daily, Weekly, and Monthly. |
| Shared form dialogs | Keep actions outside the scrolling body; name checkbox/switch controls; support fixed-set visibility and current values for custom pickers | Hidden ordinary fields retain local values. Hidden file fields clear their selection, including changes from applied AI suggestions. |

## Authority and outcomes

All mutations use the existing form mapper, hook, generated operation, trusted API, and reducer owner. No schema, generated contract, operation, or mutation authority is added. Reconciliation choices use existing AccountingClient reads through a read-only context. Edit requires one exact current-company widget ID. Duplicate, stale, foreign-scope, or unavailable selections block submission rather than infer replacements.

Receipt registration keeps the existing request-key readback. The local retry cache reuses its request ID even if registration fails after upload. A later expense-save retry reuses the resolved receipt ID. It does not claim that the expense save completed. Expense finance actions retain their existing canonical result handling and now propagate errors to the form.

The pre-existing reconciliation create/update hooks are transport-only. The existing generic update encoder refuses wire IDs above Number.MAX_SAFE_INTEGER rather than rounding them. This work preserves that refusal and tests it. Reports retain the readback limits documented in finance-authoring-preview-status.md. No additional canonical completion claim is made.

## Verification

- Shared UI and web TypeScript checks pass.
- Production Next.js build passes.
- 37 focused Vitest cases pass: dependent visibility/required fields, hidden files, current custom-field values, dirty-form behavior, expense finance failure retention, reconciliation choice/picker behavior, report inputs, and live multiselect options.
- 40 focused Node cases pass: asset parameter behavior, expense scope/kind/upload metadata and retry identity, retained unavailable edit choices, expense report operations, report source payloads, and existing widget mapping.
- Translation literal-key and duplicate-key checks pass. The dynamic-key report remains informational.
- The opaque-record baseline decreases by two occurrences; no increase is added. Browser operation transport and whitespace checks pass.
- The final production browser run passes all 18 tests (17 read-only authoring cases plus authentication setup), including template actions at desktop and 390px, record pickers, conditional expenses/assets, and receipt file clearing. New cases assert zero operation writes. These checks do not certify saved financial operations.

The browser lane uses the existing isolated seeded module lumiere-v1-finance239-e2e, PostgreSQL database lumiere_finance239_e2e, API port 48083, and web port 4317. No production data or deployment is changed.

## Deferred work

Accounting navigation and setup guidance, reconciliation execution workspaces, depreciation schedules, period-close workspaces, report body editing, and dashboard layout editing remain separate slices. The offline Expenses capture panel still has its separate receipt storage-key provenance gap. Durable receipt recovery across reloads and the existing large-ID update encoder limit require their own owner/contract work.
