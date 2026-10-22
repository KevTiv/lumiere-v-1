# UI container overflow remediation

**Status:** IN PROGRESS — shared fixes implemented; evidence and remaining audit tracked below

**Created:** 2026-10-17

**Audit baseline:** `main` at `5356f6c0893c4942856d17df9af6968710008182`

**Related:** [ERP module usability parity](./erp-module-usability-parity-program.md) · [Pre-tenant adversarial certification](./pre-tenant-adversarial-certification.md)

## Goal and evidence boundary

Keep rendered collections, controls and record values inside their owning containers while preserving readable content, keyboard access and deliberate scrolling. Start with shared renderers so one correction benefits all consuming modules.

The source inventory found 1,126 `.map()` calls across 251 non-test TSX files in `frontend/packages/ui/src` and `frontend/web`. These include data transformations, examples and primitives; they are not a count of defects. The findings below are source-level risks until a browser reproduces each case. Refresh the baseline before implementation and account for any intervening fixes.

Each implementation slice must include its browser reproduction and regression check. Record a case as reproduced, already contained, fixed and verified, or blocked with an explicit reason. Do not mark browser acceptance complete from a static review, class-name assertion or jsdom test.

## Layout decisions

- Layout owners choose wrapping, truncation or local scrolling. `.map()` remains ordinary rendering logic.
- Allow flex and grid items to shrink where needed with `min-w-0`; use `min-h-0` only when a constrained vertical layout requires it. Inspect the ancestor chain before adding either.
- Wrap full record values, URLs and identifiers using an appropriate text wrapper and `overflow-wrap: anywhere` where necessary. Keep long content readable and copyable.
- Truncate compact labels only when the complete value remains accessible through an existing detail view or an accessible disclosure. Put ellipsis on a text child when its parent is a flex button.
- Wrap action groups and keep icons usable. Move a whole control to another row before compressing it beyond usability.
- Reuse the existing module/record tab scrolling pattern for sheet tabs. Keep the selected tab and keyboard-focused tab visible. Preserve the default sizing of unrelated tab lists.
- Keep table and Kanban scrolling local. Check the width of their ancestors rather than treating deliberate scrolling as a failure.
- Fix owners and consumers directly; extract a shared helper only when several corrected consumers need the same behavior. Avoid global `overflow-hidden`, global word breaking, changes to every Button/Badge, or a new generic list abstraction.

## Ordered implementation slices

All paths below are relative to the repository root. Each slice is an independently reviewable change with targeted evidence; broad full-stack certification can follow the component fixes.

### UI-OF-01 — Shared collection toolbar

**Priority:** High

**Owner:** `frontend/packages/ui/src/entity-views/entity-table.tsx`

- Reproduce the toolbar with search, filters, saved filters, grouping, column controls, export and several configured actions enabled together.
- Make the nested right-hand action group wrap within the toolbar; allow its width to shrink to the available space.
- Bound the search minimum width and filter widths to the actual container. Handle a single long action/filter label, not only many short controls.
- Check mapped active-filter chips and selection actions with long labels/values. Keep clear/remove controls reachable.
- Retain existing action enablement, permission gates, pending state and selection behavior.

**Acceptance:** At narrow container widths every toolbar control is visible and operable without horizontal toolbar scrolling. The record table may still scroll horizontally inside its own wrapper. Keyboard access, grouping, selection and export still work.

### UI-OF-02 — Record-sheet tab navigation

**Priority:** High

**Owners:** `frontend/packages/ui/src/entity-views/entity-record-sheet.tsx`; inspect `frontend/packages/ui/src/components/tabs.tsx` for inherited sizing

- Reproduce Inventory product sheets with Variants, Vendor prices, Packaging, Discussion and Audit, and HR employee sheets with their permitted custom tabs.
- Give sheet tabs a bounded horizontal scroll wrapper and natural-width triggers, following `pages/module-view.tsx` and `entity-views/record-page.tsx`.
- Override the inherited horizontal tab-list height deliberately, including the existing group-data height variant. Avoid conflicting fixed-height and wrapping rules.
- Keep tab panels within the sheet and prevent the tab row from overlapping the first field or action.
- Test the tab set changing with permissions and record selection.

**Acceptance:** Every tab is reachable by pointer and keyboard, the active/focused tab scrolls into view, and tab panels do not overlap navigation. Closing the sheet restores focus as before.

### UI-OF-03 — Shared field and mapped-item content

**Priority:** High for record details; medium for supporting surfaces

**Owners:**

- `frontend/packages/ui/src/entity-views/entity-detail.tsx`
- `frontend/packages/ui/src/entity-views/entity-board-card.tsx`
- `frontend/packages/ui/src/documents/record-attachments-panel.tsx`
- `frontend/packages/ui/src/ai-chat/ai-chat-panel.tsx`
- `frontend/packages/ui/src/composed/ComposedCollectionDetailHost.tsx` — detail-value rendering

Reproduce long unbroken identifiers, URLs and filenames in the actual mapped children. Constrain field/card/message text at the responsible wrapper. For board footers and attachment rows, let text shrink or wrap independently of secondary values and controls. Preserve meaningful message newlines. Change formatting primitives only if a consumer-level correction cannot satisfy the required behavior.

**Acceptance:** Long values remain readable/copyable and stay inside their field, card, attachment row or message bubble. Attachment links and board interactions still work. Board content does not widen a column; the board itself retains deliberate scrolling. Verify AI chat in floating and docked layouts.

### UI-OF-04 — Feature-specific compact layouts

**Priority:** Medium

**Primary owner:** `frontend/web/app/(modules)/reports/query-builder.tsx`

- Reproduce added filter rows, populated with long field/operator labels and values. The existing empty-result mobile check does not exercise these rows.
- Give each filter row a responsive layout: stack controls when needed, retain the horizontal arrangement where the available width supports it, and keep removal reachable. Prefer container sizing when viewport breakpoints misrepresent a half-width panel.
- Inspect `entity-views/entity-pivot.tsx` chart rows for the fixed `8rem` label track plus value width; adjust only if the narrow-container case fails.
- Check direct tab-list consumers in `settings/unified-form-config-settings.tsx`, `forensics/report-detail-modal.tsx`, `forensics/forensics-view.tsx` and `web/app/(modules)/ai-harness/ai-harness-client.tsx`. Fix reproduced fixed-height or width failures locally.
- Inspect POS and task-board layouts only after confirming active route usage; an exported legacy component is not evidence that an active screen is affected.

**Acceptance:** Added filters, populated pivot rows and affected tab layouts remain operable at their actual panel widths. Longer translations and increased text size do not hide primary controls.

### UI-OF-05 — Remaining rendered-collection audit and closure

**Priority:** Follow-through after shared fixes

- Review JSX-producing `.map()` and `.flatMap()` callbacks and their parent layout chains. Exclude data-only transformations from the defect ledger.
- Start with active Settings, Reports, Inventory, Accounting, CRM, Messages and Proposals screens; include mapped error/loading/empty states when they change dimensions.
- Check repeated cards, labels, headers, footers, badges and action rows. A wrapping parent does not constrain a single oversized child.
- Classify deliberate scrollers, overlays/portals, inactive legacy code and reproduced defects separately. Do not automatically add classes to every mapped element.
- Check dashboard widget/header text and export controls where existing Card clipping could hide content.

**Acceptance:** Every reviewed risk has a disposition and evidence. Remaining unreviewed surfaces and blocked reproductions are listed explicitly; a partial audit is not declared repository-wide closure.

## Browser verification and the current blind spot

The shell in `frontend/web/app/(modules)/modules-shell.tsx` clips the outer layout and makes `<main>` scrollable. Existing COV-26 checks often compare document width with the viewport, so they can miss overflow inside main, sheets, cards and other nested containers.

Extend browser evidence alongside each slice:

1. Assert document and main containment separately. Inspect the affected toolbar, sheet panel, detail field, card, message and filter row, not just the document.
2. For a non-scrolling owner, check `scrollWidth <= clientWidth + 1` and the visible content/control bounds. Width checks alone do not establish that clipped text or overlapping children remain usable.
3. For a wrapping tab list or row, check child vertical bounds and separation from the following panel. Horizontal checks cannot detect fixed-height overlap.
4. For an intentional scroller, permit content wider than the viewport but require the scroller itself to fit its parent and verify access to the last column/tab by scrolling and keyboard. Inspect the actual overflow owner rather than nested descendants of a table.
5. Check pointer and keyboard reachability for the last action/tab, selection behavior, dialog focus and dismissal. Include permission-dependent controls without invoking unintended live mutations.

Use existing Playwright infrastructure and add a small shared assertion helper only where cases reuse it. For deterministic component stress cases, use an isolated test fixture with the actual shared components, theme and Tailwind output; no authenticated production fixture route is required. Pair it with targeted existing full-stack tests for wiring and permission-sensitive tab/action sets. jsdom tests remain useful for behavior, but cannot prove CSS layout.

| Dimension | Required cases |
| --- | --- |
| Viewport | 320, 390, 768 and 1280 CSS pixels wide |
| Container | Narrow nested panel/sheet even at a wide viewport; expanded/collapsed sidebar; docked AI where relevant |
| Content count | Empty, one, several, and enough items/actions/tabs to exceed one row |
| Content length | Normal labels, 200+ character unbroken values/URLs/filenames, long translations |
| State | Loaded content, empty/error state, relevant read-only and privileged tab/action sets |
| Interaction | Keyboard tabbing/arrow navigation, last control reachability, scrolling and text copyability |
| Text sizing | A representative 200% text-size/zoom check on affected shared layouts |

Do not multiply every dimension across every route. Cover the shared renderers with deterministic stress fixtures, then use representative real screens for integration. Screenshots aid review; geometric and interaction checks determine acceptance.

## Execution ledger

| Slice | Code | Browser evidence | Status |
| --- | --- | --- | --- |
| UI-OF-01 shared toolbar | Implemented, including long actions/chips and built-in controls | Real-component fixture, four viewport widths and 200% text | Full-stack integration pending |
| UI-OF-02 sheet tabs | Implemented through opt-in `TabsList.scrollable` | Sheet keyboard access, selected-tab visibility, panel separation and focus return | Full-stack integration pending |
| UI-OF-03 content containment | Implemented for details, board fields/footers, attachments, chat and composed detail values | Long values/badges, attachments and floating/docked message text covered; composed host retains behavior tests | Full-stack integration pending |
| UI-OF-04 compact layouts | Query filters and pivot rows fixed; form settings, AI Harness and forensic detail opt into scrolling tabs | Populated query-filter rows and pivot containment covered | Direct feature-screen checks pending |
| UI-OF-05 remaining audit | Initial source census and named risks reviewed | No repository-wide browser certification claimed | Follow-up audit remains open |

For each slice record the implementing commit/PR, reproduced case, viewport/container, targeted checks and any blocked full-stack evidence. Run the relevant UI behavior tests, changed-file formatting/lint checks and affected package type checks. Do not introduce jsdom tests that merely assert utility class strings.

Start with UI-OF-01, then UI-OF-02. They address shared interaction containers before the more varied content and feature-specific cases. No backend, contract generation or synchronization changes are required by the current findings.


## Implementation evidence — 2026-10-17

The implementation is on `fix/ui-container-overflow`, based on the audited `main` commit. Changes are restricted to frontend layouts, the isolated fixture and this plan; no dependency or lockfile changes are required.

### Concrete corrections

- `EntityTable` wraps the nested action group, bounds search/filter widths, wraps long action/filter-chip text, and constrains built-in controls under text enlargement. Saved-filter ellipsis applies to its text child.
- `TabsList` gains an opt-in `scrollable` property. Record sheets, form configuration settings, AI Harness and the forensic detail modal use it. Existing compact lists keep their default behavior.
- `EntityDetail` queries its own width before allocating twelve tracks and their gutters. Browser reproduction showed that eleven fixed horizontal gutters alone exceeded a narrow container, even after adding `min-w-0`. Field values and their badges can wrap without losing their full text.
- Board metadata/footer values wrap within a fixed column. Attachment labels, panel headings, upload controls and fields fit their panel rather than the viewport. Chat bubbles break unspaced text while preserving newlines. Composed detail values receive local text containment.
- Query-builder filter rows switch layout using their actual container width. Pivot chart rows stack in a narrow panel and preserve locally scrollable tables.

### Regression coverage

`frontend/web/tests/ui-overflow.spec.ts` uses the real components and production Tailwind/theme output via the existing isolated navigation-guard fixture. Fixture API reads are intercepted in the browser and mutation requests are aborted. This proves component layout and interactions without depending on a live ERP deployment; it does not certify authenticated module wiring.

The suite contains 13 cases covering 320/390/768/1280px viewports, narrow panels on a wide viewport, expanded/collapsed simulated sidebar space, 200% root text sizing, 200+ character tokens and badge labels, toolbar actions/selection, attachment links, deliberate table/board scrolling, record-sheet keyboard navigation/focus return, permission-dependent fixture controls, populated query-filter removal, and floating/docked chat text. The sidebar in the fixture is a width constraint, not the production navigation component. Root text sizing is not a claim of native browser-zoom certification.

Regression sensitivity was checked by temporarily restoring the original detail and chat source files at the audit baseline: the 320px shared-layout test and both chat tests failed their containment assertions. The fixed files were restored after this check. Initial browser runs also reproduced the pivot width failure before its correction and narrow attachment/toolbar failures under text enlargement.

Run the browser suite from the repository root:

```sh
pnpm --dir frontend/web exec playwright install chromium
pnpm --dir frontend/web exec playwright test --config playwright.overflow.config.ts
```

An existing Chromium binary can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The fixture is served only by the test configuration and is not an application route. The suite is independently runnable, like the existing navigation-guard suite; this change does not add a CI job or change backend validation scope.

### Completed local checks

- 13/13 Playwright overflow cases passed in one clean run (Playwright 1.59.1; Chromium 153.0.8010.0).
- 52/52 targeted UI behavior tests and 7/7 query-builder semantics/source-state tests passed.
- UI package typecheck and isolated fixture typecheck passed with the same 6 GB Node heap allowance used by the repository CI typecheck job.
- Changed UI and web/test files passed ESLint with no errors; the existing unused `react-hooks/exhaustive-deps` suppression in the pivot component still produces one warning.
- New browser files, the tab primitive and board-card component passed Prettier checks; `git diff --check` passed.
- Three expected containment failures were reproduced against the original detail/chat sources before restoring the fixes.

### Remaining acceptance

- Run representative authenticated Inventory/HR/CRM/Sales/Reports screens against a live stack, including real grants and production navigation space.
- Verify direct Settings, AI Harness and Forensics screen integrations, loading/error/empty states, long translated labels and narrow floating/docked panel geometry.
- Continue UI-OF-05 across the remaining JSX-producing collection renderers; confirm active POS/task-board usage before changing their legacy components.
- Keep document-level COV checks as smoke coverage; their current assertions alone do not establish nested-container acceptance.
