# Alpha UX sweep: execution record

Date: 2026-10-27. Status: IMPLEMENTED; LOCAL CHECKS PASSED. Hosted CI, human task review, and deployment remain separate.

Owner plan: [Alpha UX sweep](../plans/alpha-paid-user-ux-sweep.md).

## Scope and baseline

The user authorized Wave 0, modal/list fixes, and invoice/expense forms (P01-P04). P05-P08 remain later work. This run has not deployed production.

Planning source: `fe4f9c6c62d4f1fdd9a5e07d86ca3ab803bdd5d8`, existing branch `feat/settings-sidebar`. Other chats changed that checkout during this run. The UX changes were copied, integrated, and verified in a dedicated managed checkout on `codex/alpha-ux-sweep`, based on deployed main `5ada7d0b268bf9fb1f2f8f5c91f58841a2ac5e46`. Current-main shared Select controls and the retired notice-renderer removal are retained. An exact backup preceded removal of only this run's frontend edits from the original checkout; unrelated work is preserved.

Initial Railway baseline: web deployment `cc8e949d-c543-481d-8a5e-add0056cbe48`, web commit `ba572e73d94f433b1815e34d2dc764676a9fd998`. Production changed during the run. The later successful web deployment is `69ca9ecb-ff33-4d44-91b9-d14a69b5a40d`, commit `5ada7d0b268bf9fb1f2f8f5c91f58841a2ac5e46` (PR #284). A fresh Dia tab confirmed the new shared select controls; its invoice form was opened and canceled without changes. Gateway service configuration defaults to the web service in its checked-in template. OAuth redacts deployed variable values, so the exact upstream variable was not independently read. The public page was inspected directly in Chrome and, at the user's request, Dia.

Live inspection was read-only: open/cancel forms and read records. Dia confirmed that the invoice editor still places journal/accounts before date/items. The footer was reachable at the inspected desktop window size; this is not a claim that every deployed modal overflows.

## Wave 0 source inventory

The inventory identifies active source groups. Role-specific visibility and persisted outcomes are separate checks. No later-wave group is accepted merely because it is listed.

| Surface | Active task groups and owners | Disposition |
| --- | --- | --- |
| Invoice/bill create | `accounting-client.tsx` mounts `ReleasedCreateInvoiceModal` by passing companyId; runtime enabled custom fields remain in that editor. Generic and legacy creation are not the active owner. | P03 |
| Invoice/bill records | Detail/document/lines/activity; draft line edit; payment/email/credit/cancel/reset; invoice record client and form/action owners. | P02/P03; economic transitions unchanged |
| Accounting support | Accounts, journal/lines, taxes/deadlines, payments/terms, budgets/analytics, bank statements/reconciliation, assets, periods/close, FX/consolidation/intercompany; Accounting client, configs, and panels. | Later inventory group; shared shell regression only |
| Expense create/report/edit | Static `newExpenseForm` and `newExpenseSheetForm`, merged lookup options, FormModal and expenses-client handlers. Expenses does not currently pass runtimeForms to ModuleWorkView. | P04 |
| Expense review/operations | Receipt capture/review, add to report, allocations, submit/approve/refuse, timeline, post/reimburse/rebill, CSV, receipt/card queues, rate settings; expense clients/panels. | P04 capture/review; remaining policy/tasks later |
| Sales | Order/line/quotation create/edit, delivery/return, price lists, commission/CPQ/contracts/integrations, configuration, CSV/chatter; Sales RuntimeFormModal, configs and custom dialogs. | P05 |
| Purchasing | Order/requisition/line, RFQ/bid/award, return/credit, blanket orders, banks, landed cost, intake, bill-from-PO, CSV/chatter; purchasing client/configs/dialogs. | P05 |
| CRM | Lead/opportunity/contact/activity, conversion/stages/lost reasons, tags/categories/segments, address/business details, duplicates/pipeline admin, CSV; CRM runtime form/config/client. | P06; source-loading cause unverified |
| Subscriptions | Subscription/plan/tier/amendment, usage/billing/payment, deferred/recognition, CSV; subscription client/config/action owners. | P06 |
| Reports | Generate/edit/reopen, period launch, templates/layout, metrics, schedules, dashboard/widget, statements/VAT/pivot/query, CSV; Reports client/config/payload/layout owners. | P07 |
| Overview/My work/Approvals | Task/record handoffs, assignment, work item create/edit, inbox/review decisions and rule links; existing Overview/Tasks/Approvals owners. | P08 |
| Documents | Upload/folder/document/knowledge/template/designer, processing/acknowledgement, record view and CSV; Documents configs/client/record route. | P08 |
| Calendar/Messages | Event/activity creation/edit/delete confirmation; compose/record/batch actions; respective module clients/configs. | P08 |
| Settings | Company/platform/reference setup, imports, form configuration, linked authorized setup; Settings client/module/subpanels. | P08; split before edits |
| Journal/Notebook/Assistant | Note/attachment/recording; notebook cells/templates/save/export; chat/thread/file/action draft review; existing floating panels and action owners. | P08; no new editors |

## Field decisions for P03/P04

| Field group | Decision |
| --- | --- |
| Invoice party/date/reference/items | Business choices first; exact existing payload keys and validation retained. |
| Invoice currency | Read-only journal currency; no independent currency default. |
| Invoice journal/counterpart/line account | Keep visible. Existing first-eligible selection is not a proven company default. |
| Invoice terms/payment reference | Named visible payment section. |
| Company document text | Collapsed editing section, effective text/source summary; inherited/explicitly cleared/overridden values remain distinct. Notes remain document-specific. |
| Company/custom fields/request/totals | Existing captured company, runtime required custom fields, operation identity and money owners remain authoritative. |
| Expense receipt/purpose/date/type | Present before amount and specialist references; mounted file survives supported view changes and failed saves. |
| Employee | Explicit authorized company relation. Signed-in user is not an employee default. |
| Price list/currency | Keep required price list; show actual loaded currency code and explain derivation. Missing/unreadable currency cannot become a default. |
| Expense amount/quantity | Explain unit amount and quantity without changing calculations or submitted keys. Mileage/allowance retain conditional fields. |
| Optional expense references | Group project/product/taxes/notes; retain exact selection and server eligibility checks. |

## Reproduction and changes

- Baseline P01 browser run: first four stress cases failed at 390x600/844; canceled repeated failures after evidence capture. Plain dialog extended outside the viewport; long external form errors were outside its field scroll body. Baseline images/traces are under `.tmp/alpha-ux-run/wave0`.
- Initial correction bounded plain dialogs and moved generic external errors into the existing form body. A follow-up exposed footer autofocus scrolling the bounded popup away from its title/Close. The default focus treatment was corrected for overflowing dialogs; caller focus overrides remain supported. Error arrival scrolls only the form body. Browser proof also exposed a sticky header covering Close; the generated Close now sits above that header. A long record-picker label overflowed its listbox; its existing text owner now wraps the full label.
- Bills intake now starts collapsed, with its scoped draft count or source status visible. Expanding reuses the original review/actions. Mounted content retains receipt selection and nested state.
- P02 groups saved-view naming, columns and density under View settings. Frequent filters and exact linked filters remain visible. Currency labels use business names; unknown exact filters remain visible and clear their original key. Currency totals remain below the table rather than repeated above it.
- Saved invoice details start at full width. Layout controls have an explicit label; source viewing remains available. Empty source information is compact and remains distinct from query failure or an inaccessible expected receipt.
- P03 groups active invoice/bill fields around document details, items, payment and accounting. Required choices remain visible; company document text uses an effective-value summary and collapsed editing controls.
- Generic form submission also shows thrown errors inline, preserving edited values and the exact selected File. New submission/reset/form ID changes clear this error; harmless config rerenders do not.
- P04 validates company/employee/price-list/currency and form parameters before receipt registration or dispatch. Missing prerequisites throw visible errors instead of resolving without an effect. P04.1 reuses the capture outbox/sync owner for generic form recovery, with immutable complete payload, receipt/request identities and scope checkpoints. Unknown delivery permits readback only; durable dismissal keeps recovery state. Detailed recovery guidance scrolls with the fields, while status actions stay compact.
- Real saved-result checks exposed missing API projection fields. The read owner now supplies existing document-line classification/amount fields and product expense eligibility; explicit field masks remain in force. The UI still fails closed when those fields are masked or missing.

## Verification on the current-main candidate

These are separate suites, not additive totals. First failures remain in ignored `.tmp/alpha-ux-run` evidence and `/tmp/alpha-ux-*` logs. The original checkout baseline had 1,163 passing UI tests and three 5-second invoice timeouts; the unchanged focused files passed all 20 cases. That baseline is separate from the final pass below.

| Check | Result and limit |
| --- | --- |
| Current-main integration | Based on deployed `5ada7d0b2`. Current shared Select controls and the retired form-notice removal remain intact. |
| Integrated UI suite | 1,194/1,194 passed across 173 files, serial workers and unchanged timeouts. Log `/tmp/alpha-ux-final-ui-suite.log`. Later changes affect web recovery and API reads, not these shared UI components. |
| UI/web TypeScript | Passed with existing configs. Web uses the CI-owned 6 GB heap setting. Logs `/tmp/alpha-ux-final-p041-ui-tsc.log` and `/tmp/alpha-ux-final-web-tsc-complete.log`. Final source and test files preceded that web check. The first default 4 GB heap failure remains recorded. |
| Changed-file lint | All 55 changed TypeScript files passed; the final recovery/test follow-up also passed. Existing UI ESLint config was used for web because web has no standalone config. Logs `/tmp/alpha-ux-final-all-changed-lint.log` and `/tmp/alpha-ux-final-recovery-lint.log`. |
| Static guards | Final i18n, shared Select self-tests/scan, operation transport, type-debt ratchet, and vendored contracts verification all passed. Opaque count 2,314 equals baseline 2,314; the 80-entry boundary allowlist is unchanged. Logs `/tmp/alpha-ux-accepted-{i18n,selects,operation-transport,type-debt,contracts}.log`. |
| P01 modal browser | 9/9 passed at 390x600, 390x844, 1440x720 and 1440x900: containment, reachable Close/Save, retained rejected values, discard decisions, picker wrapping, Escape layers and focus. Log `/tmp/alpha-ux-current-main-p01.log`. |
| P02 list browser | 6/6 passed: short-desktop first row, scoped intake disclosure, exact linked-filter clear, saved name/density/selection. Log `/tmp/alpha-ux-managed-finance-proof.log`. |
| P02 canonical return browser | 4/4 passed after repairing the fixture's missing QueryClientProvider. Both 390/1440px and number-link/sheet-Open paths prove exact query, search, locked currency, sort, page 2, row order, scope exclusions, local scroll and focus. Log `/tmp/alpha-ux-managed-return-route-proof.log`. Synthetic records; no financial effect claim. |
| P02 return unit tests | 45/45 passed across context, engine and worklist; full unmount/remount covered. Log `/tmp/alpha-ux-managed-return-unit-node22-fixed.log`. |
| P03/P04 authoring browser | 8/8 passed after correcting real narrow fieldset overflow. Invoice/bill at 390x844 and 1440x720, expenses at both sizes, conditional fields and exact File after rejection, long invoice error at 390x600. Log `/tmp/alpha-ux-managed-authoring-final.log`. These callbacks are synthetic rejection evidence. |
| P04.1 models and gates | Recovery models 26/26, ModuleView gates 23/23, durable FormModal 19/19. Logs `/tmp/alpha-ux-p041-model-tests-admission-final.log`, `/tmp/alpha-ux-p041-module-gates.log`, and `/tmp/alpha-ux-managed-durable-form-modal.log`. |
| API read projection | Full `stdb-auth` suite 86/86 passed, including schema-backed defaults and explicit field-mask tests. Expense eligibility/saved-line helpers 16/16 passed. Logs `/tmp/alpha-ux-projection-auth-suite.log` and `/tmp/alpha-ux-projection-web-tests.log`. |
| Builds | Final canonical Next production build passed: 28.3-second compile, 113 generated pages. Separate typechecks are required because the existing Next config skips type validation. Exact candidate API debug build also passed. Logs `/tmp/alpha-ux-final-complete-next-build.log` and `/tmp/alpha-ux-candidate-api-build.log`. |
| Authenticated final saved effects | 5/5 passed against the final standalone web and candidate API: exact balanced invoice plus identical UI replay; balanced Draft vendor bill with saved line in preview after reload; generic expense with eligible product, purchase tax and real receipt plus reload; committed lost response through close/reopen/full reload with one write; existing PNG capture/reload. Log `/tmp/alpha-ux-final-saved-effects.log`, artifacts `.tmp/alpha-ux-run/final-saved-effects`. |
| Independent source review | P01/P02/P04.1 clear after correcting write-admission order, false discard copy, and blocked-readback recovery entry. No second retry owner or renderer was introduced. |

## Saved-result findings and corrections

The first authenticated bill saved its exact balanced canonical data, but the document preview omitted its line. The default API projection lacked classification and amount columns. The read owner now includes six existing `account-move-lines` fields: `exclude_from_invoice_tab`, `tax_line_id`, `display_type`, `sequence`, `discount`, and `price_subtotal`. It also supplies existing `products.can_be_expensed`, which the expense lookup now requires explicitly. Field masks still apply. The UI does not invent missing classification or amounts.

The first new expense test also had a test-only decoder error: checking inherited `some` mistook Array.prototype.some for an Option payload. It now unwraps only own Option properties and preserves arrays. Exact receipt/tax assertions remain. The real unknown-save case passed before and after the final refinement.

At 390x600, the first recovery footer left little room to inspect fields. Detailed guidance now scrolls in the existing form body; only status and its action stay in the footer. The final test requires at least 160px of field-body height and proves that the saved purpose field can scroll fully into view.

A retained request can be inspected through **Review expense save** after a reload even when expense reads fail. This action opens only the exact existing actor/org attempt. New-create controls retain their original gates. Original company, current write permission, and data readiness remain required before remote writes. Unknown delivery uses reads only.

## Local runtime and evidence limits

Only local test data was changed. The dedicated Docker project is `lumiere-alpha-ux`: module `lumiere-v1-alpha-ux-e2e`, PostgreSQL `lumiere_alpha_ux` on 55432, API 8092, web 3120, and separate blobs. Setup, migrations, seed and health passed. Final web/API binaries come from this candidate and its pinned contracts 0.3.149. The seeded SpacetimeDB module was built earlier from the compatible 0.3.145 baseline. All seven added read columns already exist there. This is bounded saved-task proof, not full same-revision database certification.

The host uses Node 22. Earlier Node 25/jsdom localStorage and cold development hydration failures remain recorded. The first Rust test attempt used stale shared-cache fingerprints; the unchanged current source passed after workspace timestamps forced a correct rebuild. The host lacked `sha256sum`; an ignored adapter delegates to `/usr/bin/shasum -a 256`, with no checksum bypass. A lower-memory test-only WASM profile completed after the first compile was stopped. No production profile, checksum rule, test timeout or financial assertion was weakened.

## Review images

Layout fixtures use production components with synthetic records or rejected callbacks:

- [Invoice list at 1440x720](alpha-ux-sweep-2026-10-27/invoice-list-1440x720.png).
- [Invoice editor at 1440x720](alpha-ux-sweep-2026-10-27/invoice-editor-1440x720.png).
- [Form dialog at 390x600](alpha-ux-sweep-2026-10-27/form-dialog-390x600.png).

These images come from the final authenticated local saved-task tests:

- [Expense recovery at 390x600](alpha-ux-sweep-2026-10-27/expense-recovery-390x600.png).
- [Same expense recovery after reload](alpha-ux-sweep-2026-10-27/expense-recovery-after-reload-390x600.png).
- [Saved expense receipt](alpha-ux-sweep-2026-10-27/expense-saved-receipt.png).
- [Saved vendor bill draft](alpha-ux-sweep-2026-10-27/vendor-bill-saved-draft.png).

## Remaining acceptance

- Same-head hosted CI and a full matching-module E2E run remain required before release acceptance.
- Non-author human task review, complete theme/text-enlargement coverage and a real mobile keyboard check remain separate. This run does not establish willingness to pay or full domain certification.
- P05-P08 remain later packets. This run did not deploy production. Railway's final read still reports successful web `5ada7d0b2`, matching the fresh Dia inspection.
