# Alpha select cleanup

## Scope

Base: `main` at `83e8be1f50d758f8bc9e1a9ec9d05993a1bfe8d9`.

The earlier select migration (#229), form picker work (#256), and expense browser repair (#262) are merged. A source inventory found 31 native select controls in 15 production files. This patch moves them to the existing shared Select in Accounting worklists/collections, invoice email/settings, insights, Work Board, delegated approvals, purchasing, quotation layouts, document designers and AI chat context.

The Finance Alpha admits Accounting, Sales, CRM, Purchasing, Reports, Subscriptions and Expenses. Shared document, settings, approval and chat controls support those workflows. This cleanup also covers remaining selectors in the supporting pages; it does not admit new modules or grant permissions.

## Shared behavior

- A single-value Select with more than 14 options shows a search input. Group labels do not count as options. Fourteen options keep the existing simple popup.
- Search matches option labels or their explicit `textValue`. Filtering retains the selected label and the native form value. Arrow keys move through matching, enabled options; Enter selects; Escape dismisses the popup and returns focus. Reopening clears the search. Escape closes only the popup when it is inside a dialog. Searchable form fields retain their label-to-trigger ID binding.
- Explicitly searchable record pickers keep their existing search. MultiRecordPicker keeps array values and chips; each option now displays a checkbox that reflects its checked state. The entire option toggles it. Disabled and unavailable selections stay locked.
- Empty filter, default-style, neutral-accent and ordinary-actor choices still emit the original empty string. A private sentinel is used only inside Radix items. Saved view names are encoded separately so a name equal to the sentinel remains usable.
- Production web/UI source must use the shared controls. `pnpm selects:check` checks JSX with the TypeScript parser and prevents direct Radix Select imports outside its shared owner. Tests, development routes and separate React Native primitives are outside this web-source gate.

## Browser fixture maintenance

The wider Alpha run exposed stale synthetic fixtures. The bank fixture now supplies the existing account-type and common-partner requirements. The allocation fixture supplies its existing authorized lookup inputs and matching history; its money-field assertions use the current text-input format. Rich-text assertions inspect editor content rather than a retired native textarea. Email tests exercise supported managed PDF selection rather than expecting the retired attachment restriction. No production matching, allocation or email rule was relaxed.

## Validation

Validation uses the unchanged vendored contracts 0.3.149 package, verified for all three consumers. Local browser checks use production components with synthetic data and controlled HTTP boundaries. They prove UI interaction and scope/readback behavior; deployed authorization and release acceptance require their separate gates.

| Check | Local result |
| --- | --- |
| Shared UI unit/component suite | 1,167 passed |
| Accounting worklists, bank/email review, operational flows and Accounting insights | 54 browser cases passed |
| Invoice appearance and content | 16 browser cases passed |
| Cross-module insights | 20 browser cases passed |
| Shared select search and multi-select checkboxes | 4 browser cases passed at 320px and 1440px; screenshots inspected |
| Work Board navigation, claims, decisions, recovery and scope fences | 35 browser cases passed |
| Shared UI TypeScript | Passed |
| Web TypeScript | Passed |
| Shared-select source guard | Passed; all six self-tests passed |
| UI source lint | Passed |
| Opaque-record ratchet and immutable browser transport | Passed |
| Translation keys and duplicate JSON keys | Passed |
| Main E2E discovery | 427 tests in 169 files load; full authenticated execution not run |
| Hosted CI, production deployment and deployed Alpha acceptance | Not run by this patch |

The 129 browser cases ran in bounded local batches. Work Board tests wait for filter navigation and the current query before opening reviews that can otherwise be retired by a scope transition. Accounting fixtures and rich-text assertions follow the current production read/form contracts; no production matching, allocation or email rule was relaxed.

Release through the existing application PR/CI process. This is a frontend change with no schema, contract pin, provider, tenant-data or permission changes.
