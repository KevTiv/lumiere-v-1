# Alpha user experience sweep

Status: CODE SWEEP IMPLEMENTED; CI VALIDATION PENDING. Wave 0 and P01-P04 passed the recorded local checks at `4755fecaf39a83aa2a23add6efa19050119ca574`. The user then authorized the remaining code sweep (P05-P08) and directed that CI execute testing. P05-P08 are implemented in the same draft PR. The extension preserves the existing operation owners and visual style. Unsupported custom-field create continuations are blocked before dispatch and are listed as capability dependencies in the execution record. See the [execution record](../evidence/alpha-ux-sweep-2026-10-27.md) for packet coverage and evidence limits. No new local test run, deployment, or human acceptance is implied.

## 1. Goal

A user who did not build Lumière can find a task, enter business information, review the result, save it, and return to it without a developer explaining database fields.

The first audience is a small-business owner, a finance operator, and an employee who submits expenses. Accountants and administrators retain the specialist controls that their tasks require. Permissions decide access; a persona description does not grant it.

Success means task completion with correct saved results and usable recovery. A smaller field count or a new appearance alone is not acceptance.

## 2. Baseline and scope

**Scope addition, 2026-10-28:** Alpha includes the [contextual ERP assistant and help documents feature](./alpha-assistant-help-artifacts-plan.md), tracked as AIH-29. Follow the user's Dia-style direction: contextual side chat grounded in ERP records, existing draft/review handoffs, and generated Markdown/static HTML opened in a modal above the ERP or a dedicated in-app document view. Save and revise guides under their module, reopen them from Documents/Knowledge, and retrieve/cite applicable guides in future chats. Core code and local checks are complete in the working tree; see the [implementation evidence and remaining release gates](../plan/alpha-assistant-help-artifacts-status.md). This addition is not covered by the completed P01-P08 code-sweep status above. Its HELP-01 through HELP-05 packets and acceptance cases own the new work. Existing document/RAG and governed-run gates still apply.

- Reviewed public application: https://api-gateway-production-d680.up.railway.app.
- Railway web service: `738b69d4-6f86-4da4-bbe5-ba435101c40a`, production environment `dbeb35da-dcc5-43bb-ad1d-0066aa530199`.
- Latest successful web deployment rechecked during execution on 2026-10-27: `69ca9ecb-ff33-4d44-91b9-d14a69b5a40d`, commit `5ada7d0b268bf9fb1f2f8f5c91f58841a2ac5e46` (PR #284). A fresh Dia page read confirmed the shared select changes. See the execution record for the earlier baseline and routing limit.
- Planning source: `fe4f9c6c62d4f1fdd9a5e07d86ca3ab803bdd5d8`. The implementation was isolated on `codex/alpha-ux-sweep` and integrated with deployed main `5ada7d0b268bf9fb1f2f8f5c91f58841a2ac5e46`. Unrelated work in the original checkout was preserved.
- Preserve unrelated untracked Python cache files. No baseline test run was performed during planning.
- Finance modules: Accounting, Sales, CRM, Purchasing, Reports, Subscriptions, Expenses.
- Supporting paths: Overview, My work, Approvals, Documents, Calendar, Messages, Settings, plus reachable Journal, Notebook, and AI Assistant panels. Audit linked handoffs without expanding Alpha admission.

Inventory every visible create, edit, review, view, and confirmation entry point in this scope. Record each as accepted, needs correction, blocked, or outside the current admitted workflow. Inspect the active implementation: shared configuration, runtime overrides, and custom editors can produce different forms for the same business record.

This run implements presentation and bounded correctness repairs needed for these tasks. New financial policy, schema changes, contract publication, new permissions, and new module admission require separate work packages. Keep an affected task blocked until its dependency is resolved. Deployment is a separate step after integrated evidence is ready.

Use these existing plans as the owning guidance:

- [Design system](erp-ui-design-system-completion-plan.md).
- [Existing UX roadmap](frontend-erp-ux-improvement-roadmap.md).
- [Overflow remediation and its integration ledger](ui-container-overflow-remediation-plan.md).
- [Finance input decisions](../plan/finance-input-cleanup-status.md).
- [Finance review workspace](../plan/finance-review-workspace-status.md).
- [Finance operation and recovery boundaries](../plan/finance-workflow-tools-status.md).

Historical verification in those documents is context, not a pass for the new integrated commit.

## 3. Reference conventions

These are recurring patterns and documented product conventions. They are not a formal agreement across all ERP products. Mobbin images were inspected; ERP behavior below comes from official documentation. Apply structure and interaction choices through Lumière components.

| Decision | Evidence | Lumière rule |
| --- | --- | --- |
| Keep the list close to its controls | [PayPal invoice list](https://mobbin.com/screens/70f7a95d-2278-4deb-a6ee-4cfbfe5bfb25) and [Xero invoice list](https://mobbin.com/screens/bd69a8ad-e350-422a-9d31-7ce24abfe965) show search, filters, and records together. [Odoo search](https://www.odoo.com/documentation/19.0/applications/general/search.html) puts filters, grouping, and saved searches in the search menu. [Business Central filtering](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-enter-criteria-filters) uses a filter pane and saved views. | Keep search, frequent status choices, and active filter summaries visible. Put view naming, columns, density, and uncommon filters in deliberate menus or panels. Preserve exact URL filters and existing local preference scope. |
| Put commercial information before specialist details | [Square invoice editor](https://mobbin.com/screens/36da6e2b-4313-4c20-82fa-7b41199c2272) separates lines and totals from settings. [Shopify purchase order](https://mobbin.com/screens/2d749fed-77f8-4378-af70-5d636fd6025d) groups supplier, products, cost summary, and purchasing information. [ERPNext purchase invoice](https://docs.frappe.io/erpnext/purchase-invoice) starts with supplier, reference, dates, and items, then reviews taxes and totals. | Start transaction editors with party, dates, items, quantities, prices, and totals. Keep accounting, delivery, and document-content settings in named sections with summaries. Do not hide an unresolved required choice. |
| Use established defaults, with visible overrides | [Odoo customer invoices](https://www.odoo.com/documentation/19.0/applications/finance/accounting/customer_invoices.html) documents customer-derived terms and accounts, an automatic journal, and per-invoice overrides. ERPNext's purchase-invoice documentation describes supplier defaults. | Only derive values through an existing, validated default rule. Show the effective value and its source. Multiple eligible records are not a default rule. Missing setup gives a useful explanation and an authorized setup link. |
| Separate draft save from confirmation | [ERPNext sales orders](https://docs.frappe.io/erpnext/sales-order) separates Save from Submit. Odoo customer invoices separate Draft from confirmation and posting. | Labels describe Lumière's actual effect: Save draft, Submit for review, Post, or Queue email, as supported. Saving must not imply approval, posting, payment, or delivery. Do not import another ERP's state machine. |
| Review evidence beside expense fields | [Remote expense review](https://mobbin.com/screens/6a8ec814-8c0f-4f9e-a3e3-83dc585cd9d5) shows the source alongside fields. [Mercury expense capture](https://mobbin.com/screens/48e4e848-26d7-43ca-9a00-6d84072c26fa) puts receipt upload near the start. | Keep a receipt visible during review on wide screens. Offer one-pane views on narrow screens. Show actual upload and attachment state; retain the mounted editor and selected file through view changes. |
| Distinguish a short dialog from a document workspace | [Business Central page types](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-pages-overview) distinguishes simple dialogs, document pages, and assisted setup. Square and Shopify use substantial document editors. | Use a dialog for a short bounded decision. A long line-item editor may use a full-page or wide review host after task review. Reuse the existing editor and operation owner; do not build a second form. Moving a route is an explicit packet decision, not a universal modal rewrite. |
| Place actions by their scope | [Business Central action guidance](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-actions-user-interface) distinguishes page actions from section actions and promotes task actions. [Mercury invoice detail](https://mobbin.com/screens/f46a2587-26e3-4922-a8d0-d25acfd64768) groups record details and payments. | Put the next document action in the record header. Put line actions beside lines. Use one content-tab row; separate layout controls from content navigation. Related records retain exact links. |

Reference differences require a decision, not a blend. For example, Odoo and Business Central use different filter containers. Choose one Lumière treatment for the same task and apply it consistently. Mobbin results that did not show the requested task are excluded as evidence.

### Preserve Lumière's visual language

Keep Quiet Precision: existing mineral/graphite surfaces, restrained teal interaction accent, Geist font variables, tabular money, leading header rule, existing navigation treatment, and document-paper presentation. Retain default/Ocean preferences and light/dark modes. Keep status colours independent of the brand accent.

Use current semantic tokens, spacing/type scales, shared field primitives, workspace/context tabs, and theme owner. Do not import reference colours, fonts, logos, CSS frameworks, sample data, or nested card layouts. Do not add a parallel form renderer or a new global preference system.

The following are Lumière acceptance choices, not claims of ERP consensus: modal containment at the specified viewports, keeping save actions reachable, complete Back restoration, and preventing false success or duplicate dispatch.

## 4. Findings to start the issue ledger

| ID | Evidence and limit | First owner |
| --- | --- | --- |
| UX-A01 | Live invoice list: filters, saved-view naming, density, and repeated totals push the first row near the bottom of the desktop viewport. | Lists/records |
| UX-A02 | Live invoice creation: accounting choices and five document text sections share the form with ordinary commercial entry. Preview and fixed save bar already exist. | Accounting |
| UX-A03 | Live new expense: required pricelist appears first; receipt upload appears later. Source code derives currency through pricelist. | Expenses |
| UX-A04 | Live saved invoice: nested view controls and an unavailable source pane consume space. Business fields include `OutInvoice` and `Residual`. | Lists/records |
| UX-A05 | Earlier live review showed Accounting task-area navigation and different workspace links elsewhere. Local source now has shared workspace guidance. Reproduce on the chosen implementation baseline before changing it. | Navigation |
| UX-A06 | User reports overflowing modals. Specific failing modal, viewport, and state still need reproduction. Shared FormModal already has bounded height and an internal scroll body. | Shared layout |
| UX-A07 | CRM live overview showed incomplete-source and source-loading errors. Cause and current reproducibility are unverified. | CRM; query owner if needed |
| UX-A08 | Code review: expense submit has early return paths for invalid employee/pricelist/currency. Verify whether these cause silent failure or false success through the active wrapper. | Expenses |

Each issue must record route/action, persona and granted role, company, build SHA, viewport, state, reproduction steps, screenshot, owning component, severity, and acceptance test. A code risk is not a reproduced live defect.

Priority order: P0 data loss, false success, duplicate effects, or incorrect scope; P1 blocked task, unreachable control, or unexplained required input; P2 repeated effort, excess navigation, or layout inconsistency; P3 cosmetic correction. Complete the inventory even when a lower-priority issue is deferred.

## 5. Field-decision register

Before changing a form, register each field: user task, visible label, internal field/payload key, current source, required rule, role visibility, company scope, proposed treatment, missing/ambiguous-value behavior, and proof test.

| Treatment | Rule |
| --- | --- |
| User choice | A business decision the user must make. Use named authorized records, clear units, and searchable choices where needed. |
| Context-derived | Use an existing validated company, parent record, or explicit default. Show a summary. Revalidate when context changes. |
| Server-derived | Keep IDs, request identity, computed outcomes, and server-owned state out of ordinary editable fields. Preserve the existing owner. |
| Advanced | Less frequent but valid choice. Show the current value in a summary. Expand the section when its fields need correction. |
| Read-only | Show the effective business value and reason it cannot be edited here. |

Required safeguards:

- Invoice currency currently follows the journal. Keep that coupling.
- Invoice journal/account selection currently includes first-eligible selection. Prove a configured default before treating it as an invisible business decision.
- Expense pricelist supplies currency. Replace or explain that path before removing the control.
- The signed-in user is not automatically a verified employee. Receipt registration requires the correct employee relation.
- Sales warehouse/pricelist and purchasing vendor/pricelist must remain valid required relations.
- Period-launched reports retain their locked period/type/scope context.
- Static form definitions own operation field names. Runtime configuration can control labels, permitted visibility, and custom fields. Preserve both layers and required constraints.
- Retain null/absent/empty/zero/false distinctions, exact IDs, currency precision, explicit clearing, and inherited document-content values.
- Use business terms without removing legitimate accounting terms. Explain specialist choices where needed. Translate labels and help through existing i18n namespaces.
- Unavailable options must distinguish loading, denied access, failed lookup, missing setup, and no search matches.

## 6. Agent run and ownership

Use one coordinator and at most three workers. During implementation, normally use two implementation workers plus one independent QA worker. Workers inherit the configured model; no model override is required.

The coordinator owns the issue ledger, baseline, packet assignment, shared-file locks, integration, test service lifecycle, evidence index, and final status. Workers own only their assigned files. Agents in the same checkout see each other's edits. Concurrent branches do not isolate a shared checkout; use separate managed worktrees when independent branches are needed.

The planning assignments are complete. Execution uses two implementation agents and one independent QA agent under the coordinator. The execution record states which packets and checks are complete.

| Wave | Worker A | Worker B | Worker C | Exit |
| --- | --- | --- | --- | --- |
| 0: establish evidence | Inventory active forms, fields, and default rules | Reproduce modal/list/view defects on the deployed version and local baseline | Record baseline checks and critical task scripts | Full scoped entry-point inventory; named failures; chosen source revision; reference decisions |
| 1: shared foundation | P01 modal containment and focus | P02 invoice/bill list controls and record-view structure | QA extends existing fixtures and reviews both packets | Shared behavior accepted; no field-value or save regression |
| 2: finance reference tasks | P03 invoice and bill creation/edit | P04 expense capture, report, and review | QA verifies saved results and recovery | Both tasks complete through save, reload, reopen, and edit |
| 3: commercial tasks | P05 sales and purchasing | P06 CRM and subscription tasks | QA checks task clarity, relations, and denied/error states | Commercial tasks accepted or explicitly blocked by owner dependency |
| 4: remaining Alpha paths | P07 report generation and schedule forms | P08 supporting setup, documents, approvals, productivity dialogs | QA checks remaining inventory and style consistency | Every scoped surface has a disposition and evidence |
| 5: integration | Coordinator integrates exact revision | Independent task review by a non-author | QA runs integrated critical paths | Release candidate evidence complete; remaining issues explicit |

A worker handles at most two or three related journeys per packet. Split large module packets into sequential child packets. Start the next wave only after its dependencies are accepted. Do not spread a new form treatment across modules before invoice and expense reference tasks pass.

### Packet boundaries

| Packet | Files to inspect and own | Deliverable |
| --- | --- | --- |
| P01 shared layout | `frontend/packages/ui/src/components/dialog.tsx`, `forms/form-modal.tsx`, `forms/modular-form.tsx`, their tests, and the existing overflow fixture/spec | Reproduced failures fixed at the owning container. Extend the existing overflow plan ledger. Keep one body scroll region where appropriate; header, errors, actions, and portalled pickers remain reachable. |
| P02 list/record/navigation | Accounting list components, `entity-views`, `composed/finance-review-workspace.tsx`, `pages/module-view.tsx`, `pages/workspace-nav.tsx`, `frontend/web/lib/business-workspace-navigation.ts`, invoice record client | Compact list controls; business filter labels; one content navigation pattern; compact unavailable source treatment; complete return context. Coordinate invoice component ownership with P03. |
| P03 invoice/bill | `accounting-components/create-invoice-modal.tsx`, relevant detail components, `lib/accounting-form-configs.ts`, `frontend/web/app/(modules)/accounting/**` | Task-grouped active custom editor and any reachable generic form, field register, valid summaries/defaults, retained preview/draft recovery. Trace the released branch; do not repair an unused legacy branch without evidence. |
| P04 expenses | `lib/expenses-form-configs.ts`, active expense registry overrides, `frontend/web/app/(modules)/expenses/**`, `frontend/web/lib/expenses-create-params.ts` | Receipt-oriented entry, explained currency/employee context, conditional expense types, useful inline validation, retained attachment and request identity. |
| P05 sales/purchasing | Their static form configs, module controllers/custom dialogs, and parameter builders | Customer/vendor and lines first; named delivery/invoicing sections; specialist options disclosed; related workflow links intact. |
| P06 CRM/subscriptions | Their form configs and module clients, relevant query/default helpers | Clear starting state, stage/setup recovery, contextual customer/plan choices, readable business labels, explicit source failures. Fix query defects through their owner rather than hiding them. |
| P07 reports | `lib/reports-form-configs.ts`, reports module client, `frontend/web/lib/reports-module-form-payloads.ts` | Type/period first; comparison and display options grouped; exact period context retained; generation and schedule effects labelled accurately. |
| P08 support | Active Settings/Documents/Approvals/Tasks/Calendar/Messages/Journal/Notebook/Assistant dialogs and form configs | Setup links with a return path, understandable reference creation, usable confirmations, remaining overflow repairs, correct role gates. Inventory then split; this is not one unrestricted shared-components edit. |

Paths under `accounting-components`, `forms`, `lib`, `pages`, `entity-views`, and `composed` in this table are relative to `frontend/packages/ui/src` unless fully qualified.

Shared-file rules: P01 alone changes dialog/form shells. P02 alone changes shared list/navigation/review components. Domain workers request changes from those owners. QA owns browser acceptance specs; domain workers own focused model/component tests. Reserve translation namespaces per packet; the coordinator resolves edits to shared locale files. The coordinator alone updates broad registries, central exports, and this run ledger.

No agent starts, seeds, resets, publishes, or stops a shared test service independently. Existing browser fixtures reuse ports and authentication-state files. Serialize them unless the coordinator assigns separate ports and auth paths.

### Dispatch template

```text
Execute packet <ID> from docs/plans/alpha-paid-user-ux-sweep.md.
Base revision: <SHA>. Allowed files: <explicit list>. Shared-file owners: <names>.
Task: <persona, visible entry point, intended saved result>.
First reproduce and record the current problem. Verify the active custom/runtime form.
Use the linked reference decision and current Lumiere tokens/components.
Register every changed field's source, required rule, payload key, and treatment.
Preserve permissions, exact scope, operation owner, draft state, and retry identity.
Implement only this packet. Request shared-owner changes instead of editing their files.
Run focused checks. Ask the coordinator to run shared-stack browser checks.
Return changed files, screenshots, exact commands/results, saved-result proof,
remaining issues, and any owner/contract dependency. Do not deploy or claim certification.
```

## 7. Acceptance matrix

| Task | Required proof |
| --- | --- |
| Find work | Visible navigation and command search reach permitted invoices, bills, expenses, approvals, and reports. |
| Find/open/return | Search, filters, sort, page, scroll, and row focus survive record open and Back. No scope broadening. |
| Create/edit invoice or bill | User enters party, dates, lines, and valid accounting choices; preview matches; exact saved draft survives reload and edit. |
| Capture/review expense | Correct employee, currency, amount, and receipt relation survive save/reopen. Mileage and allowance show relevant inputs. |
| Review/send/confirm | Labels match actual effects. Preview, queue, approval, posting, and payment are distinct. Test only admitted transitions. |
| Generate/reopen report | Correct type, period, currency, scope, and saved output/definition; display choices do not alter financial meaning. |
| Handle missing setup/data | Loading, restricted, unavailable, empty, and confirmed zero remain distinct; the user has a permitted next step. |
| Correct failed save | Inline error or focusable summary identifies the problem; entries and attachments remain; editor does not report success or close. |
| Recover uncertain save | Inspect the original request by readback. No automatic duplicate write or new request identity. |
| Leave edited work | Discard cancellation retains entries; confirmed discard exits once; pending save prevents unsafe dismissal. |
| Use modal/lookup | Long title, errors, options, many fields/lines, menus, and date picker fit their owner or scroll deliberately. Close and save remain reachable. |
| Use keyboard | Logical Tab/Shift+Tab, visible focus, reachable errors, correct Escape layer, and focus return to the opener. |

Run critical tasks at 390x844, 1440x900, and 1440x720. Add 390x600 for short dialogs. Retain shared checks at 320/768/1280px and 200% text enlargement. Include long translated labels, long names, many lines, unavailable relations, restricted readers, and default/Ocean light/dark. Test native mobile keyboard behavior on a real device before claiming it; a shortened viewport alone does not prove it.

For critical lists at the agreed desktop viewport, show the heading, primary action, frequent filters, and first record without scrolling past saved-view setup. At narrow widths allow deliberate local table scrolling or the existing suitable alternate view; do not hide mandatory data to meet a screenshot target.

Evidence levels remain separate: live read-only reproduction; deterministic component layout proof; authenticated saved-work proof in an isolated seeded stack; deployed smoke proof. Component callbacks and fixture mocks cannot establish a financial effect.

## 8. Test execution and evidence

Reuse existing tests before adding coverage:

- `frontend/web/tests/ui-overflow.spec.ts`: containment owners, long content, keyboard sheets, enlarged text. Add modal stress cases.
- `frontend/web/tests/accounting-ui.spec.ts`: synthetic production components; no authenticated effect claim.
- `frontend/web/tests/e2e/finance-authoring.spec.ts`: form/preview controls and short-height footer coverage.
- `frontend/web/tests/e2e/finance-review-workspace.spec.ts`: view/file retention, saved source reads, density, unavailable counts.
- `finance-alpha-navigation.spec.ts`, `finance-workflow-review.spec.ts`, `finance-capture-tools.spec.ts`, `finance-payment-tools.spec.ts`, `finance-assets-close-tools.spec.ts`, and `finance-report-layout-tools.spec.ts` under the same E2E directory.
- `cov08a-manual-invoice-effect.spec.ts` and `cov08-invoice-payment-recovery.spec.ts` when save/payment/retry behavior changes.
- Existing form discard/draft/runtime/cardinality tests and `entity-table-view-state.test.tsx`.

Representative commands, from the repository root; execute only those relevant to the packet, then integrated checks:

```sh
pnpm --dir frontend/web exec playwright test --config playwright.overflow.config.ts
pnpm --dir frontend/web test:e2e:accounting-ui
pnpm --dir frontend/web test:e2e:workspace-navigation
pnpm --dir frontend/web test:e2e:navigation
pnpm --dir frontend/web test:accounting-ui:models
pnpm --dir frontend/packages/ui test
pnpm --dir frontend/packages/ui typecheck
pnpm --dir frontend/web typecheck
pnpm --dir frontend i18n:check
pnpm --dir frontend type-debt:check
pnpm --dir frontend operation-transport:check
pnpm --dir frontend/web build
git diff --check
```

For the P05-P08 extension, the user directed that CI run tests. Do not start local suites, typechecks, builds or browser stacks for that extension. Add focused regression source to the existing CI gates and review the source/diff. The earlier P01-P04 results remain historical evidence at their recorded revision. Do not increase debt baselines or weaken assertions to obtain a pass.

The coordinator must check service ownership, unused ports, storage isolation, and the Makefile before setup. Proposed isolated module: `lumiere-v1-alpha-ux-e2e`; proposed web/API ports: 3120/8092. These are unreserved proposals, not a running stack. Confirm all database/blob targets are isolated before invoking the harness.

```sh
# Publishes and seeds the selected test module; coordinator only.
make e2e-smoke-setup E2E_STDB_MODULE=lumiere-v1-alpha-ux-e2e E2E_WEB_PORT=3120 E2E_API_PORT=8092

# After the coordinator builds/starts the matching production web/API stack:
make e2e-playwright-only E2E_STDB_MODULE=lumiere-v1-alpha-ux-e2e E2E_WEB_PORT=3120 E2E_API_PORT=8092 E2E_WORKERS=1 E2E_ONLY_SPEC=finance-review-workspace.spec.ts
```

The existing setup/test targets can stop services on selected ports, publish modules, and seed data. Existing Finance E2E specs include uploads and writes, even when tagged as fixtures. Never point the whole group at live Alpha. Keep deployed audit read-only unless a separate specific production action is authorized.

Each packet returns: task/issue IDs, base and tested SHA, files, field decisions, reference links, before/after screenshots, interaction assertions, exact saved-result IDs in the isolated stack, commands/results, first-attempt failures, and remaining blockers. Save evidence under a run-specific ignored artifact directory; keep customer data and secrets out of screenshots and committed reports.

Record baseline failures before changes. Separate environment failures from product failures. A skipped test is not a pass. Require a final critical-path run without retries on the integrated commit, plus required same-head CI. Share one production build for final browser verification; rebuild when code changes.

## 9. Human review and release gate

A person who did not build the stack performs three tasks in the isolated environment: create an invoice, capture a receipt, and find/reopen the saved record. The coordinator provides the task goal, not field-by-field instructions. Record completion, questions, wrong turns, and recovery. Do not claim that automated checks establish willingness to pay or usability validation.

Release candidate acceptance requires all P0/P1 issues closed or the affected capability explicitly excluded, all scoped surfaces classified, critical saved-work and keyboard checks passed, style checks passed, and remaining P2/P3 issues listed. UI acceptance is not full module U4/U5 certification.

Prepare a reviewable release candidate with exact commit, screenshots, test report, rollback target, and release notes. After separately authorized deployment, verify the actual served revision and repeat read-only critical smoke checks. Preserve the distinction between source completion, local evidence, hosted CI, deployment, and human task acceptance.

## 10. First dispatch

Start Wave 0. Record the deployed/local difference and the full entry-point inventory. Then assign P01 and P02, with QA running independently. After these pass, use P03 and P04 to establish the accepted form treatment before sweeping the other modules.

The coordinator must publish a short wave result: accepted tasks, blocked tasks and their owners, evidence revision, next packets, and unresolved decisions. Do not leave an agent waiting on an unstated dependency or declare the sweep complete with unclassified surfaces.
