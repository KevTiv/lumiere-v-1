# ERP UI completion: workflows, presentation IR, and a coherent design system

**Status:** Proposed implementation specification; source-level review, not visual/runtime acceptance.  
**Created:** 2026-09-14.  
**Execution:** [UI work ledger](../plan/erp-ui-completion-ledger.md).  
**Parent:** [ERP/harness coordination](../plan/erp-harness-implementation-coordination-plan.md).  
**Product gate:** [T0 module usability parity](erp-module-usability-parity-program.md).

## 1. Decision and scope

Improve the existing Lumiere UI system, not replace it with another component library or a parallel JSON renderer. Use Odoo as a reference for ERP workflow completeness, Vercel/Geist for restrained visual hierarchy, Apple for clarity, feedback and accessible interaction, and PostHog for analytical exploration and an optional warm visual treatment. These are reference patterns, not evidence that a particular design will work for our first organization. Validate our resulting workflows with that organization.

The completion unit is a usable workflow with truthful state and data, rendered consistently from existing approved contracts. A restyled dashboard, component gallery, reducer wrapper or config file is not workflow completion.

This specification adds UI acceptance requirements to every applicable COV package. It does not replace COH outcome ownership, INT business workflows, ADV certification, HSEC, or existing frontend-IR architecture. Module-specific adoption remains owned by the COV worker; shared UI workers do not create a competing module implementation lane.

**Scope commitment:** all existing/planned ERP module families remain on the coverage matrix. Temporarily disabling an unsafe or unfinished surface is containment, not completion. A narrower first-org rollout requires an explicit product decision; workers cannot hide modules or relabel required workflows as optional merely to report parity. Equal coverage means the same applicable quality gates, not identical charts or equal button counts.

## 2. Review baseline and limits

Two code baselines must not be conflated:

- PR #44 planning head inspected: `c4e1e1b17ec5263c866acb0e782810f0edcd663d`. The shared UI/config files below were read at this exact revision.
- PR #25 presentation save/reopen head inspected: `7b676cb00ee051d0522f422c40854bd93ec90207`. Its Rust models and TypeScript presentation definitions were read separately. This stack has a bounded collection/detail composer, private draft save/reopen, version/conflict handling and server validation. Its PR explicitly leaves publication and activation to later milestones.
- PR #32/#37 descriptions report later presentation schema packaging and contract pins. Those descriptions are discovery evidence, not acceptance of their combined runtime. BASE-00/UX-00 must choose and validate an integrated implementation head and current immutable release before any producer or consumer work.

The presentation-core package was not available at the inspected PR #44 revision, while it was readable on PR #25. This is an integration dependency, not a reason to rebuild it.

No seeded app, component gallery, browser interaction, screenshot comparison, accessibility audit or first-user usability test was executed in this pass. A local checkout attempt was blocked by network name resolution. Findings below identify source behavior or risks requiring reproduction; none certify the current rendered product. Do not infer application-wide failures from a shared component without tracing its actual callers.

## 3. Existing owners to preserve

| Concern | Existing owner / direction |
| --- | --- |
| Visual primitives | `frontend/packages/ui/src/components/`; retain existing shadcn/Radix-based primitives and behavior. |
| Module and record surfaces | `pages/module-view.tsx`, `entity-views/*`, existing entity record sheets, tables and boards. |
| Forms | `forms/modular-form.tsx`, `form-modal.tsx`, `runtime-form-modal.tsx`, config merger and field renderers. Keep one shared field/editing system across dialog, sheet and full-page hosts. |
| Dashboard rendering | `pages/dashboard-grid.tsx`, `dashboard-widget-renderer.tsx`, `pages/widgets/*`, existing drill-down and export adapters. |
| Theme | `components/theme-provider.tsx`, `styles/tokens-base.css`, `theme-extended.css`, palettes/shells and `lib/theme-colors.ts`. |
| Persisted presentation model | Rust `crates/presentation-core`, approved dictionary/validator and generated contracts on the presentation stack. |
| Surface-neutral definitions | Existing `frontend/packages/presentation-core`; reconcile its static dashboard definitions with the Rust wire model instead of introducing a third schema authority. |
| Business and permission semantics | STDB/domain operations and current server authorization. UI metadata only selects approved presentations and operations. |
| Errors/effects | COH typed outcome and transport conventions, consumed by UI adapters. No new global error engine. |

Follow [multisurface presentation](frontend-multisurface-workflow-presentation-plan.md), [workflow integration](erp-workflow-integration-program.md), [module maintainability](../plan/module-by-module-maintainability-plan.md), and the frontend-IR coordination plan on its integrated branch. Human/admin composition precedes AI composition.

## 4. Source findings to close

References in this table are repository paths at the baselines in section 2. Severity is implementation priority, not a claim of a demonstrated security exploit.

| Finding | Source behavior observed | Required outcome / owner |
| --- | --- | --- |
| UI-F01: form can report success without a save | `forms/form-modal.tsx::handleSubmit` calls optional `onSubmit`, then closes/toasts success even when absent. It supplies its wrapper to ModularForm, so a `config.onSubmit`-only caller is not forwarded by that wrapper. A callback that catches its own failure and resolves can also look successful under the default close behavior. | Prove callers; require one effective submit binding and explicit success/outcome. Missing handler, rejection, waiting or unknown outcome must never become Saved. UX-07 + COH-02/10. |
| UI-F02: invalid stored filters silently broaden displayed results | `lib/stored-dashboard-resolver.ts::applyDomain` returns original rows for malformed JSON and returns true for unknown operators. | Reject invalid definitions with a card-scoped diagnostic; do not silently show a wider result. These are presentation-filter semantics over supplied rows, not proof of a server tenancy bypass. UX-08. |
| UI-F03: totals/date ranges can conceal data uncertainty | The same resolver converts missing numeric fields to zero, defaults unknown aggregation to count, and retains rows with unrecognized timestamps under a time filter. | Explicit measure/time-field codecs, missing-value policy and completeness metadata. Unknown, partial or stale data must not impersonate a confirmed zero or full total. UX-08. |
| UI-F04: runtime form conversion is lossy | `lib/runtime-form-config.ts` maps MultiSelect/UserSelect to select, unknown field types to text, and matches field identities through aliases/normalization and first match. MultiSelect defaults are not preserved as arrays in the select conversion. | Stable generated field IDs and explicit migration maps; preserve cardinality and value types. Unsupported or ambiguous bindings produce diagnostics, not guessed editors. UX-06. |
| UI-F05: shared module state cannot express all outcomes | `pages/module-view.tsx` accepts data/loading and supplies `data[tab.id] ?? []`; there is no corresponding per-tab error/denied/stale/partial contract. Parent handling must be audited. | Shared resource-state presentation and per-panel recovery, with no failed-query-to-empty-table coercion. UX-03/04. |
| UI-F06: keyboard behavior needs correction/proof | ModuleView assigns `tabIndex={i}` to tab triggers. `forensics/report-card.tsx` compact clickable div has no keyboard activation/focus semantics. | Preserve primitive roving-tab behavior; semantic links/buttons for cards, no positive tab-order overrides. Browser keyboard proof required. UX-04/10. |
| UI-F07: renderer-local config is not a wire model | `lib/dashboard-types.ts` includes ReactNode, component constructors, callback functions, arbitrary color strings and raw data alongside presentation intent. | Keep legitimate checked-in renderer extensions local. Persisted/admin/AI definitions accept versioned component/binding IDs and data-only options, never React code or callbacks. UX-11/12. |
| UI-F08: chart semantics are under-specified | `pages/widgets/line-chart-widget.tsx` fixes height to 300px, uses monotone interpolation, generic k-number formatting and tooltip defaults. Existing series lack declared currency/unit/timezone/comparison/quality metadata. | Shared chart presentation semantics and responsive plot sizing. No implicit smoothing, unsupported units or color-only interpretation. UX-08/09. |
| UI-F09: theme foundations exist but adoption is uneven | Semantic HSL tokens, Geist font tokens, palette/shell dimensions exist. Stored dashboard resolver still uses fixed hex chart colors; ThemeProvider has unguarded localStorage access and client-effect initialization. | Extend the existing owner, migrate remaining raw chart colors, test blocked storage/defaults/first paint. Flash is a risk to verify, not observed evidence. UX-01/02/09. |
| UI-F10: report card type and localization need clarity | `forensics/report-card.tsx` is an incident/forensic record, not a universal analytical report; its local date formatter fixes en-US. Dashboard export buttons currently lack a shared pending/error outcome surface. | Distinguish record cards, KPIs, saved report definitions and generated report artifacts; reuse common chrome, locale/formatting and safe action feedback. UX-10/03. |
| UI-F11: parallel presentation generations | PR #25 Rust PageNode/ComponentKind currently admit Collection and Detail. Its TypeScript dashboard definitions separately expose metric groups, time series and report tables. | Extend/reconcile the canonical existing models deliberately; inventory which definitions are static-only versus persisted. No claim that forms/charts are already admitted by ModuleDraft. UX-00/11/12. |

## 5. Design direction and source references

Use these primary sources as reference material; review dates are 2026-09-14. Lumiere decisions below are our synthesis, not quotations or claims of feature/rating parity.

| Source | Adopt | Deliberately do not copy |
| --- | --- | --- |
| [Odoo 19 views](https://www.odoo.com/documentation/19.0/applications/studio/views.html) and [reporting](https://www.odoo.com/documentation/19.0/applications/essentials/reporting.html) | Record-contextual actions, related-record smart links, list/kanban/calendar/report views where relevant, shared search/group/filter context, graph/pivot drill-through. | Odoo XML/Python runtime or raw method names as Lumiere authority; a button for every reducer. |
| [Vercel Geist colors](https://examples.vercel.com/geist/colors) and [errors](https://vercel.com/geist/error) | Neutral surfaces, explicit text/border/state roles, restrained hierarchy; field/action/panel errors differentiated with useful identifiers. | Replacing the current library wholesale; promotional landing-page layouts in transactional screens. |
| [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles), [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [charts](https://developer.apple.com/cn/design/human-interface-guidelines/charts) | Consistency, predictable controls, responsive context preservation, clear feedback, progressive disclosure, readable/accessibly described charts. | Platform-only interaction assumptions, decorative glass behind dense tables, compulsory animation or proprietary bundled fonts. |
| [PostHog dashboards](https://posthog.com/docs/product-analytics/dashboards) and [chart themes](https://posthog.com/docs/product-analytics/color-themes) | Reusable insight references, visible effective filters, card-level actions, independent refresh, consistent series identity and theme choices. | Raw query editors in ordinary ERP config; copying dashboard filter overrides into security scope; public sharing by default. |
| [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) and [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Native/standard keyboard semantics and measured hit-target behavior. | Declaring accessibility from screenshots alone. |

### Visual language

Default: calm neutral canvas, restrained elevation, clear content boundaries, one dominant action per context, readable dense data, and strong typography hierarchy. Retain the existing Geist/system font foundation. Use tabular numerals for aligned quantities and money; reserve monospace mainly for IDs, codes and technical evidence.

Optional **Warm** preset: a PostHog-inspired cream/graphite/amber direction in light mode, with an independently designed dark counterpart, stronger outlines and modest radii. This is our proposed treatment, not an assertion that every PostHog screen uses these exact tokens. Do not copy branding, mascots or logos.

Keep `theme` (system/light/dark), existing `palette`, existing `shell`, and proposed `density` conceptually separate. Define default/compact/comfortable density as needed without making theme choose permissions, content, chart meaning or business behavior. Avoid adding a parallel ThemeProvider. Preserve existing ocean/css-art users until an explicit migration decision.

Set all palette values centrally. Semantic roles include canvas/surface/raised/muted, primary/secondary/disabled text, border/focus, accent, success/warning/danger/info, and categorical/sequential/diverging chart palettes. Critical status meaning is never reassigned by a brand accent. Prove contrast for each enabled mode, including error/focus/disabled selections and charts; user accessibility overrides win over organization aesthetics. Do not assume reducing opacity preserves contrast.

Density changes spacing, not business capability. Aim for at least 44 CSS-pixel touch targets in touch-oriented layouts as a Lumiere product target; separately verify WCAG 2.2 AA minimum target/spacing rules and exceptions. This is not a claim that Apple's point values and browser CSS pixels are interchangeable.

## 6. Shared ERP interaction patterns

### Module shell and collections

Persistent organization/company context; predictable navigation groups; module title, concise purpose and contextual action. Keep filters, grouping, search, selected view, time range and saved-view state coherent across list/chart/pivot navigation. Switching company clears/rebinds selection and invalidates relevant data; a late response from the old context cannot populate the new view.

Use list/table for exact operational records, kanban for stage-based work, calendar/timeline for scheduling and graphs for analysis. Do not force all views onto every module. Large tab sets need grouped navigation or an accessible overflow treatment rather than uncontrolled wrapped tab rows.

Tables need column/value alignment, visible units/currency, stable row identities, meaningful selection counts, approved bulk actions, pagination semantics, persistent safe preferences, and accessible row actions. Identify whether the dataset is complete or a server page. Never calculate organization-wide totals from a loaded page. Client sort/filter is acceptable for declared bounded complete datasets; otherwise use approved server query semantics.

Use native table semantics unless spreadsheet-like editing genuinely needs an accessible grid. Virtualize only after measuring actual datasets and preserving keyboard/assistive navigation. A row click cannot be the only route to opening a record.

### Record workspace

A common record header holds reference/title, canonical status, primary next action, supporting actions and related-record links. Sales order, invoice, purchase order, production order and approval screens should make upstream/downstream continuation obvious.

Use existing sheets for quick inspection. Longer multi-section editing, line items and reconciliation may use a full-page workspace with the same underlying form/field/action owners. Do not build a second editor per host. History/activity/attachments belong in a predictable supporting area. Cancellation, rejection, reversal, waiting and terminal states have meaningful next steps; a generic Undo never promises to reverse an irreversible economic effect.

### Forms

Compile typed generated field/operation bindings into the existing FormConfig renderer. Preserve null/absent/empty/zero/false, decimal precision, timestamp units, timezone and patch clear-versus-preserve semantics. Missing relationship data is not an empty selectable list with a successful submit.

Group fields by user task; keep labels visible; show units and help where needed; progressive disclosure cannot hide required unsatisfied inputs with no explanation. Relation pickers use authorized bounded search; disabled/denied options are distinct from no matches. Preserve multi-select cardinality and dependent-field invalidation.

Submission has one outcome owner. Map field diagnostics inline, then a focusable error summary for multi-field problems; keep values and focus context after failure. Missing submit bindings disable submission and produce a developer/config diagnostic. Do not infer success merely from a resolved void callback that can swallow an error. Close/reset only on admitted success; waiting, stale and unknown-effect states retain recovery context. Confirm discarding dirty edits; server save/revision behavior must not be replaced with local optimistic flags.

AI suggestions remain optional, field-reviewed and subject to the same validation. A generated suggestion cannot write hidden/read-only fields, bypass approval or silently replace user edits arriving after the suggestion request.

## 7. Graphs, metric cards and reports

### One metric contract, several presentations

A metric binding must identify its approved source, measure/aggregation, unit, currency policy, time field/grain/timezone, filters, period/comparison, freshness, completeness and drill-through reference. Choose the canonical owner with contracts/analytics; UI presentation consumes these semantics, it does not invent financial formulas or maintain a parallel SQL language.

Resource state is separate from values: loading, ready, empty, refreshing-with-valid-prior-data, stale/offline, partial, denied, error and invalid-definition. A valid zero is not any of the latter states. Percent change from a zero/missing baseline is explicitly unavailable or shown as an absolute delta; an upward cost trend is not automatically green. `favorableDirection` or the equivalent domain meaning is independent of geometric trend.

Metric/series data, effective query context and source freshness are available to both charts and accessible data tables. Financial exports retain canonical precision even when display values are abbreviated. Multi-currency totals require a documented conversion basis or a per-currency breakdown; mixed-unit series cannot be silently summed.

### Chart conventions

| Question | Default view | Rules |
| --- | --- | --- |
| Trend over time | Line or appropriate step series | Real timestamps, explicit timezone/grain, missing intervals remain gaps; no implicit smoothing of accounting/event data. |
| Compare categories | Sorted bars | Zero baseline for magnitude comparison; explicit Top N/Other; long labels remain usable. |
| Composition of a whole | Stacked bars; donut only for a small meaningful non-negative whole | Label totals and categories; no decorative donut for negative or unrelated balances. |
| Budget/actual/variance | Bullet/progress or grouped bars plus exact table | State favorable direction and denominator; support overshoot/negative variance truthfully. |
| Operational analysis | Grouped/pivot table with optional chart | Measures/dimensions come from approved definitions; drill-through preserves effective filters and reauthorizes. |
| Funnel | Ordered, defined process stages | Do not imply cohort conversion or conservation unless the source semantics support it. |

Retain Recharts initially. Add renderer-level formatting, responsive plot height, keyboard/touch inspection, legends and a table alternative instead of a speculative chart-library migration. Colors bind to stable series identity, not result ordering. Supply a textual takeaway without making unsupported statistical claims. Use non-color cues; reduced motion disables nonessential chart animation. No automatic animation on every query refresh.

For long-period device telemetry, request reviewed aggregate buckets with min/max or other truthful envelopes where needed; disclose aggregation/downsampling and preserve extrema/gaps. Exact export uses the authorized source, not a sampled chart. Measure the chart separately from query/network time; do not promise instant rendering without a dataset/device budget.

### KPI, report and artifact cards are different objects

A KPI card answers a current question: label, exact/abbreviated value, unit, scope/period, comparison meaning, freshness and a useful drill-through. Avoid nested cards and decorative rings that hide business context.

A saved report card describes a reusable report definition: title/purpose, owner, approved parameters, version, last successful run, freshness, access and available actions.

A report result/artifact card describes an immutable output: run ID, actual input period/scope, definition version, generated time, evidence/source links, validation state and authorized open/download. Rendering a card must not rerun an expensive report or sandbox.

The existing forensic ReportCard remains an incident-domain record card. Share card chrome/status/action primitives where semantics match; do not turn it into a universal report data model.

Dashboards share effective date/filter context; cards that differ visibly state the override. User presentation filters may narrow authorized data, never override server tenancy/company/field restrictions. Isolate one card failure from siblings. Deduplicate identical dependencies; refresh is bounded and explicit. Export, print and sharing are separately authorized actions and show failure/pending states. Exported report scope must match its label and displayed filters; a PNG of a partial dashboard is not certified full financial output.

## 8. IR/config integration without another authority

Target pipeline:

```text
canonical ERP operations/resources/field and metric metadata
   + Rust-owned versioned presentation contracts
   + approved component dictionary
                    |
         validated presentation definition
         (checked-in or admin-authored)
                    |
         typed runtime data/action bindings
                    |
       existing platform renderer/components
                    |
    semantic tokens + palette/shell/density
```

Keep four concerns distinct: business contract, presentation intent, runtime data/effects, and theme. Styling changes cannot change query scope, mutation arguments, approval rules, money calculations or retry policy.

Inventory existing static FormConfig/EntityTableConfig/DashboardWidget and Rust ModuleDraft before migration. An adapter may retain trusted in-repo callbacks/custom components; it must not serialize them or evaluate tenant JavaScript. Persisted definitions are closed, versioned data with approved references and bounded options, not arbitrary JSX, CSS, HTML, URLs, SQL, reducer names, regex code or script callbacks. Treat any proposed expression language as an explicit security-reviewed contract, not a convenience for this UI pass.

Extend the existing presentation model by coherent families: editor/action bindings; metric/series/report bindings; additional collection views only where real workflows need them. Validate component kind/version, contract release, field identity/type/cardinality, query bounds, result shape, action availability, safe formatting and supported renderer. Unknown definitions show safe diagnostics rather than silently dropping nodes or rendering a fallback type.

Schema changes follow producer source -> deterministic generated output -> immutable contracts release -> pinned consumer, preserving the already delivered packaging work. Do not move IR construction, codegen or business logic into the generated contract repository. Statically known defaults need not all become server-owned runtime documents before a useful UI can ship.

Admin flow: select an approved module surface -> configure supported fields/views/cards -> preview with current authorized bindings -> save exact revision -> publish/activate only through the existing admitted lifecycle -> inspect version/diff -> restore an earlier presentation version. Reopen/conflict behavior must preserve local edits and reject late/stale responses. Reuse PR #25's save/reopen semantics; do not mistake them for an already implemented publish path. Unavailable publication remains explicitly blocked until its owning frontend-IR milestone is accepted.

A rollback of presentation never rolls back business effects. Read-only preview cannot execute mutations on render. Reordering/hiding UI is not permission. Mandatory identity, outcome and safety context cannot disappear through cosmetic customization. AI-authored definitions later use this same validation/preview/admission path.

## 9. Adoption and proof

Prove three reference workspaces before broad module migration:

1. Invoice/order: list -> inspect -> edit -> validate -> confirm -> linked downstream record; exact amounts, line items, server error and stale-save recovery.
2. Inventory/manufacturing: stock/production record -> operational next action -> quantity/quality result -> trend/table drill-through; missing stock, partial result and interrupted connection.
3. Reports/admin composition: choose measures/period -> inspect chart/table -> save/reopen supported definition -> change theme/density -> export authorized result; invalid definition and denied binding.

Then every COV module adopts the relevant shared patterns using its own existing ledger, not a separate restyling PR per page. Track workflow coverage and UI quality as separate fields; neither can compensate for the other.

Each adoption record names module/workflow, actor/company, supported views, theme/density/mode, data states, field/operation bindings, canonical outcome proof, screenshot/test revision, accessibility results and unresolved blockers. All promised module families remain visible in this evidence matrix even when temporarily disabled.

### Required evidence

- Component fixtures for every admitted shared variant and meaningful state. Reuse existing Storybook/test infrastructure if present; otherwise add the smallest fixture/gallery route, not a new documentation platform.
- Visual captures from the actual renderer at 360, 768, 1280 and 1440 CSS pixels; assess 320px reflow/200% zoom separately. Legitimate wide tables scroll inside their region, never force page-wide loss of controls.
- Default and Warm presets in light/dark; system mode, density, keyboard-only navigation, reduced motion, long/localized labels and denied/missing data. Do not certify all combinations by one attractive screenshot.
- Automated accessibility checks plus manual keyboard/focus and representative screen-reader checks. Include tab roving, dialogs returning focus, searchable selects, grids only where appropriate, live outcome announcements and non-color status interpretation.
- UI tests assert actual form values, generated operation inputs, returned outcomes and canonical readback. Fixtures/screenshots alone cannot pass a business workflow.
- Chart tests: missing versus zero, no baseline, negative values, mixed currency, stale/partial data, date-boundary/DST behavior, invalid filters, unknown operators, pagination completeness, drill-through and export consistency.
- Performance: baseline named datasets/devices; bound acquisition/aggregation and inactive-tab subscriptions; ensure theme/re-render does not rerun model/sandbox work. Record actual timing and bundle deltas, not invented thresholds or ratings.
- Short task-based sessions with first-org representatives: complete routine work without a developer, recover from one error, find a linked record, interpret a report's period/scope and switch appearance. Record observed errors/confusion and prioritize fixes. Synthetic agent walkthroughs are not human usability evidence.

## 10. Acceptance and non-goals

T0 requires the applicable UI gates alongside U5/INT/ADV: truthful data, no false Saved state, clear next action, coherent cross-record navigation, resilient errors, accessible interaction and theme-consistent presentation. Advanced theme editing or later AI-generated UI is not a reason to postpone ordinary ERP workflow fixes.

No whole-repo redesign, proprietary font distribution, new business-rule engine, blanket replacement of Recharts/Radix/forms, universal giant component, arbitrary tenant CSS/JS execution, new report runtime, duplicate query/cache layer, or lowered workflow coverage is authorized by this plan.

The next implementation begins with UX-00 baseline reconciliation and the existing COV/COH owners. UX work is accepted only from integrated code and required evidence, not from this document.