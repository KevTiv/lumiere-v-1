# Alpha English UI source review

Date: 2026-10-30.

Source baseline: `fbb9a6b56b9a93bce4cd105b85f9099b6dff87a0`, verified against GitHub `main` during this review. Work branch: `codex/alpha-english-ui-release`. The original `feat/settings-sidebar` checkout and its uncommitted files were preserved.

This is a source review. The user chose this scope after live inspection was blocked by the locked Mac and disabled browser access. It does not establish which revision is deployed or prove screen geometry in a browser.

## Scope and method

Reviewed the Alpha shell, navigation, command search, shared input/button/select controls, workspace navigation, and English strings. Traced detailed examples through the active CRM contact panels, Expenses card reconciliation/settings panels, and Accounting analytic forms. Checked Finance dashboard action wiring and the notebook execution path. Sales, Purchasing, Reports, and Subscriptions were sampled through their clients and shared configuration; their complete operator journeys were not tested.

Review criteria: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), existing Lumière shared controls, clear English task labels, and agreement between an action and its implemented result.

## Findings

P1 means correct before English Alpha acceptance. P2 means a visible consistency or wording issue. Layout risks need browser confirmation at the stated sizes.

| Priority | Source location | Finding and user effect | Recommended correction |
| --- | --- | --- | --- |
| P1 | `frontend/web/app/(modules)/crm/contact-payments-and-messages-panel.tsx:59`, `:122`, `:146` | Five reads default to empty arrays. Loading, failed reads, and denied reads can show **No payment activity** or **No operational messages**. A user can mistake unavailable information for a confirmed empty history. The panel is mounted by `crm-client.tsx:1383`. | Use the existing query-state and notice helpers. Keep each section's loading, unavailable, denied, and empty states distinct. Offer Retry where supported. |
| P1 | `frontend/web/app/(modules)/crm/contact-payments-and-messages-panel.tsx:116` | Settlement, allocation, and fee amounts are printed as bare numbers. The card provides no currency label. Its helper at `:26` also converts missing or invalid amounts to zero. This makes a payment review ambiguous. | Resolve the actual currency for each amount, show its code, and use the shared money formatter. Keep unavailable amounts distinct from zero. Group totals by currency before adding them. |
| P1 | `frontend/web/app/(modules)/expenses/expenses-ops-panel.tsx:135`; `expenses-admin-panel.tsx:148`, `:260` | Active specialist forms use raw inputs with placeholders but no persistent labels or accessible names. A label disappears after typing. Amount fields use the default text input mode. | Use existing Field/Input controls with linked labels. Add decimal input modes and visible field errors. Preserve the current payload and validation rules. |
| P2 | `frontend/packages/ui/src/components/button.tsx:26`, `input.tsx:12`, `select.tsx:86` | Default buttons are 32 px, inputs are 36 px, and selects are 40 px. Small buttons are 28 px. Corner radii differ too. Shared table toolbars place these controls together; they can look assembled from different component systems. Touch minimums do not solve the desktop mismatch. | Define one form-control height and one compact toolbar height in the existing shared controls. Choose a matching button size in each row. Verify forms, toolbars, and pickers together before changing defaults. |
| P2 | `frontend/web/app/(modules)/expenses/expenses-admin-panel.tsx:145`; `expense-record-picker.tsx:18` | One two-column grid mixes a label-plus-picker block, placeholder-only inputs, and small action buttons. The children have different vertical structures, so fields do not share a common input baseline. | Give every field the same label/control structure. Put related actions in a separate footer row. Check 390 px, short desktop windows, and enlarged text. |
| P2 | `frontend/packages/ui/src/lib/accounting-form-configs.ts:2332`; `frontend/packages/i18n/src/locales/en.json:3291` | A business form tells the user to “extend JSON on the server for multi-split”. The form only accepts one target account. This is implementation guidance in a normal accounting task. | Say **Allocate 100% to one analytic account.** Keep the supported limit explicit. Put developer instructions in technical documentation. |
| P2 | `frontend/packages/ui/src/lib/accounting-form-configs.ts:1835`; `frontend/packages/i18n/src/locales/en.json:3286` | Analytic tags require comma-separated numeric IDs. The helper says there is no list to choose from. The form asks the operator to know internal record identifiers. | Use an authorized tag lookup when the read path exists. Until then, hide this optional input or give a clear supported limitation. Do not invent a lookup or accept free-text names as IDs. |
| P2 | `frontend/packages/i18n/src/locales/en.json:11941`, `:11942`, `:11957`, `:12203` | Expenses still uses **Statement external ref**, **Merchant key**, **Upsert ... used on capture and create**, and **Currency ID**. These are inconsistent with the business labels used by nearby forms. | Use the copy table below. Check whether an identifier really is required before replacing its label with a business name. |
| P2, layout risk | `frontend/web/app/(modules)/crm/contact-payments-and-messages-panel.tsx:113`, `:140`; `crm-inbox-panel.tsx:210` | Payment references, message subjects, and message bodies can contain long unbroken strings. Some flex children have no `min-w-0`; text lacks a wrap rule. The subject and badge also share a non-wrapping row. | Use a shrinking text owner, wrap reference/body text, and allow the badge row to wrap. Check long references and URLs at 390 px. Overflow was inferred from source, not observed live. |

## What gives the UI a prototype feel

The strongest signs in the reviewed source are inconsistent control dimensions, label-free specialist inputs beside complete picker fields, and technical instructions in normal task forms. These are concrete consistency problems. They do not require a new visual theme.

The shared workspace navigation also renders a second tab row when a workspace has only one view (`frontend/packages/ui/src/pages/workspace-nav.tsx:28`, `:96`). This is a design recommendation: reduce repeated navigation for single-view workspaces while preserving accessible panel naming. Confirm the effect in the browser before changing this shared renderer.

Use business information first, consistent field rows, and one clear primary action per task. Keep specialist setup and calculation details available through named sections. Avoid replacing useful financial limits with promotional wording.

## English copy recommendations

These are proposed corrections; this patch does not apply a broad copy rewrite.

| Current text | Proposed text | Constraint |
| --- | --- | --- |
| Statement external ref | Statement reference | Keep the exact external reference value. |
| Merchant key | Merchant reference | Confirm whether the provider expects an identifier. Do not label it Merchant name without that evidence. |
| Upsert mileage and per diem rates used on capture and create. | Add or update mileage and daily allowance rates. | Keep the existing rate rules. |
| Currency ID | Currency | Appropriate where the field is already a currency picker. |
| Extend JSON on the server for multi-split | Allocate 100% to one analytic account. | Describe the form's actual supported operation. |
| Operational messages ... parent batch’s review status | Messages for this contact and their approval status. | Retain the distinction between message status and batch approval where they differ. |

The reviewed CRM composer already says **Queue message** and explains that queued messages are not confirmed delivered. Preserve that distinction. The current invoice record route also uses `returnHref`; return-context work must account for that existing owner.

## Logic and feature review

- The notebook is an editor with browser-local storage. It has no execution backend. `notebook-panel.tsx:216` only reports that execution is unavailable, and the Run control at `:315` is disabled. This is an explicit limitation, not evidence of false execution. It still does not belong in the current Alpha task set.
- Journal stores notes in browser-local storage (`journal/journal-panel.tsx:155`). It is separate from Accounting journal entries and journal setup.
- The Reports client has a fallback no-op callback for dashboard action IDs (`reports-client.tsx:1018`), but its active overview removes that quick-action section at `:1294`. This review does not report an active dead button from that fallback alone.
- Several workflow calls catch a rejected promise after a domain workflow owner handles feedback. An empty catch alone was not treated as proof of an action with no logic.
- Source inspection cannot prove provider delivery, saved business effects, or the usability of every active action. Those require the appropriate runtime and operator checks.

## Implemented feature hiding

The `finance-alpha` profile now excludes Messages, Journal, and Notebook from global discovery. This applies to the sidebar, command search, and overview links that use the existing profile helper. Journal is also removed from the Settings form catalog.

The module shell uses the same profile helper to omit the Messages notification bell and to stop mounting Journal and Notebook. Their open callbacks are not passed to the sidebar or command palette when hidden.

Accounting journal entries and journal setup remain available. This is a presentation change: it does not delete saved notes or notebooks, change permissions, block existing direct record URLs, or remove CRM contact message history and Finance workflow data. The full shared-component profile remains available.

## Verification

- Focused unit/component tests: **28 passed**, across workspace profile, product surface catalog, and command palette tests.
- Existing browser regression extended for 1440 px and 390 px: expects no Messages navigation, no Journal/Notebook quick actions, and no notification bell. **Not executed.**
- `git diff --check`: passed.
- Syntax transpilation: passed for all five changed TypeScript files. This is not a type check.
- No production build, full type check, hosted CI, deployed browser check, or release deployment was performed.

Recommended next correction order: CRM unavailable/empty states and currency display; labelled Expenses controls; shared size consistency; English copy; narrow-screen and enlarged-text acceptance. Use the existing components and effect owners for each change.
