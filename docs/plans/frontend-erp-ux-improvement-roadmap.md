# Lumière ERP UX Improvement Roadmap

## Summary

The frontend has strong functional coverage and a reusable shadcn-based component layer, but its information architecture mirrors backend entities more than user goals. The clearest example is horizontal tab overload: Accounting and Inventory expose roughly 20 entity tabs each, while Sales exposes about 15. Users must remember where data lives instead of following recognizable workflows.

The redesign should support both owners and specialists through role-personalized defaults:

- Owners land on a cross-functional command center focused on exceptions, trends, approvals, and next actions.
- Specialists land in role-specific workspaces optimized for frequent operational workflows.
- Everyone retains access to the complete module catalog through navigation and command search.

The highest-value shift is from “module → dashboard → many entity tabs” to “role → job to be done → actionable queue → record.”

## Key Changes

### Lumière workspace refinement — 2026-10-16 implementation

The first implementation studies [Studio Admin](https://studio-admin.arhamkhnz.com/dashboard/default),
source revision `9bf6d382f24a9538bf64ecb319c1b58b4ee1a0bb`, as the visual and interaction
reference. The implementation adapts Lumière's existing components and operations;
no Studio source was copied. The source baseline is Lumière `ff98a918a607`;
PR #218 integrates main `979de024` and preserves its Rwanda setup, import,
tax/currency and company-scoped posting safeguards. Every invoice/bill create
entry point, including overview actions, uses the setup-readiness gate.

The delivered direction is **Lumière / Quiet Precision**, not a Studio skin:
warm mineral surfaces, graphite type, restrained deep-teal interaction accents,
leading header/navigation rules and paper-like documents. Dark mode has its own
ink/slate roles; existing Ocean users retain violet/cool preferences. Status
meaning remains independent of the brand accent. Shared renderer roles carry
this direction into static and runtime forms, module/record headers, approved
saved collection/detail previews, dashboard widgets and invoice documents,
without adding persisted styling fields. Ownership and propagation are recorded
in [the design-system plan](erp-ui-design-system-completion-plan.md#5-design-direction-and-source-references).

Delivered in the working tree:

- Shared responsive shell: existing Sidebar primitives supply a mobile drawer,
  compact sticky header, visible command search, current company, notifications,
  theme, table density, content width and persisted navigation preferences.
- Accounting navigation: seven primary workspaces with contextual local views and
  an Advanced / Configuration menu. All 32 existing destinations retain their
  canonical `?tab=` IDs. Browser history and filter clearing preserve context.
- Accountant Home: currency-separated posted receivables/payables, exact document
  links, overdue/draft/bank/payment/deadline/period queues, recent documents, and
  six months of posted document counts with an accessible monthly table. Each
  source retains its own unavailable/loading/denied state.
- Invoice and bill lists: canonical document anchors, controlled URL filters,
  exact overview drill-downs, per-currency totals, permission-aware create controls,
  and removal of unsupported menu actions.
- Invoice composer: responsive editor and live document preview, mobile Edit /
  Preview controls, fixed totals/actions, and preserved uncertain-submission
  reconciliation. The existing full-page record adds financial context, document
  preview, visible payment/PDF actions, and explicit read failures.
- Global border styling: Tailwind preflight now precedes the shared theme, so the
  neutral border token remains effective.
- Mobile template behavior: wrapping titles/actions, full-width narrow-screen
  form fields, bounded dialog scrolling, panel-contained wide tables and 44px
  coarse-pointer Button/Input/Select/tab targets. Accounting summaries use one
  column below 360px to retain readable amounts.

Implementation owners remain `DashboardWorkspace`, `WorkspaceNav`, `ModuleView`,
the Accounting route's overview model and controller, and the shared Accounting
components. The existing ThemeProvider owns appearance/density; the existing
command palette owns navigation/search; the generated operations and application
hooks continue to own accounting effects. No contract release is required.

Verification uses focused component/model tests and an isolated browser fixture
that imports the actual production components and stylesheet at desktop and phone
widths. Its synthetic data and callbacks are explicitly labelled; it does not
authenticate, post a payment, create a persisted invoice, or establish U4/U5.
`frontend/web/playwright.accounting-ui.config.ts` is the reproducible browser entry.

Verification results for this working-tree implementation:

- The integrated full UI suite passed: 635 tests across 105 files, including
  shell preferences, command search, workspace navigation, create gates,
  accounting lists, setup readiness, invoice submission, shared style propagation
  and selected light/dark/default/Ocean contrast contracts. This is not a blanket
  accessibility certification of bespoke layouts or charts.
- The integrated web unit suite passed: 388 tests, including Next configuration.
- 34 model/navigation/action tests passed; rerun with the web package's
  `test:accounting-ui:models` script.
- All 36 browser checks passed after final style integration at 320, 390, 768
  and 1440px, using the same bundled Geist fonts as production. This includes
  actual configured module/static-form/saved-preview renderers, default and
  Ocean light/dark modes, long action labels, opaque form focus rings, 44px
  coarse controls and a 480px compact-height dialog-footer check. The latter is
  not native software-keyboard certification; authenticated long-company
  switching also remains outside this synthetic fixture.
  Use `test:e2e:accounting-ui` with an installed Playwright Chromium, or set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium executable.
- The type-debt ratchet now has no new opaque-record occurrences and records
  Accounting's reduction from 162 to 150. Missing/redacted invoice amounts
  display as unavailable, not zero.
- Default Turbopack production build passed, including all 108 static pages.
  Removed unnecessary forced React aliases so Next owns renderer-specific
  resolution; four config regressions cover aliases, headers and runtime BFF.
- Remote validation and authenticated accounting effects remain separate gates;
  synthetic browser checks are not posting/reconciliation acceptance.

Open work:

- Split the 54-resource Accounting subscription and broad route controller into
  mounted workspace controllers with bounded subscriptions. Disabling individual
  reads alone would leave false-ready/empty states and incomplete form lookups.
- Add import-review summaries and an allocation-residual projection before
  claiming a true unallocated-payment balance. The current queue is explicitly
  payments without invoice links.
- Add a richer synthetic accounting scenario through the existing seed workflow;
  verify its reference-data/tax prerequisites and canonical effects in an isolated
  tenant before any live Alpha execution.
- Run the revised accounting golden workflows against a configured authenticated
  stack, followed by operator usability/accessibility review and explicit product
  admission. First-organization exposure remains unchanged and at REVIEW.
- Adopt the shared compositions in CRM/Sales, Purchasing/Inventory, Documents,
  Projects, Messages and administration. Those module-specific layouts remain
  separate implementation work; the common shell already applies to them.

### Invoice appearance and content — alpha implementation

The invoice-personalization follow-up adds a dedicated panel under Organization
settings, alongside the selected company's canonical legal/address/tax settings.
It does not use the legacy general organization-settings Save payload as its
branding authority.

- Organization defaults and exact-company overrides are immutable publications
  in the existing `document_template` table, reserved model `account_move` and
  report type `lumiere-invoice-profile-v1`. Missing values inherit; an explicit
  empty string clears a value. Restoring inheritance publishes an empty override.
- Approved fields are managed logo, renderer-owned accent choice, email, phone,
  website, notice, terms, payment instructions and footer. The editor uses plain
  text and a live sample, not tenant-authored executable templates or raw HTML.
- The existing completed-upload pipeline supplies PNG/JPEG logos capped at 2 MiB,
  4096px per dimension and four million pixels. A SHA-256 pin is part of the saved
  managed URL; browser downloads and PDF reads reject a changed asset rather
  than silently replacing historical branding. This is not an archive of every
  historical blob if its stored bytes are lost or corrupted.
- Publishing requires existing template-create and organization/company-write
  permissions. Saves check the previous version, append once, then confirm the
  exact scoped publication by readback. An uncertain result retains a read-only
  reconciliation path. Concurrent publications are latest-wins: the preflight is
  not an atomic compare-and-swap or an exclusive editor lock.
- The composer exposes customer-facing overrides separately from notes and
  retains existing custom-field metadata. Dirty or uncertain drafts cannot be
  silently rebound to another company or overwritten by a late defaults read.
- Server-generated outgoing invoice/credit snapshots capture trusted company
  identity, profile version IDs and resolved content. Posting refreshes the
  snapshot once from trusted current settings; issued views/PDFs never inherit
  later defaults. Draft review/export resolves current approved settings.
  Incoming vendor bills and ordinary journal entries do not become branded
  outgoing invoices. Reserved client-supplied snapshots are replaced or stripped.
- Invoice PDF output uses escaped, paginated HTML through the existing trusted
  Chromium service, with completed-blob ownership/integrity checks and no remote
  logo fetches. Renderer absence, corrupt logos and malformed reserved content
  produce explicit failures, not a deceptively successful minimal PDF.

The customer name comes from the persisted invoice partner display name. PDFs
are rendered on demand from the saved snapshot; automatically archiving the exact
PDF bytes at issuance is not included. This slice does not add a historical
customer billing-address/tax snapshot. Public
custom-field selection/order, multiple elaborate layouts, email personalization,
signatures and multilingual template variants remain follow-up work. No financial
formula, posting permission, reducer signature, table schema, contract release,
deployment or first-organization admission is changed by this slice.

Verification covers the shared UI suite (652 tests), web unit suite (388 tests),
invoice models, focused profile/wire-format tests, UI/web type checking and a
production web build. Both production Rust paths and the standalone module's test
targets compile (`cargo check --locked --tests`). Thirty-one exact-source Rust
projection/blob/profile helper tests pass in isolated harnesses, and the actual
Chromium worker renders a checked 200-line, 14-page personalized invoice. The
full native API test build exceeded this environment's memory while compiling
unchanged generated contracts; a whole-module native test build was also stopped
for memory pressure. Neither is counted as a passing full-suite run. Database
authorization verification and execution of the added posting/replay scenarios
still require the configured runtime test stack. Parent PR security
classification and authenticated workflow gates
remain prerequisites for merging this follow-up.

### Accounting workflow gaps — alpha follow-up implementation

This batch follows invoice personalization (#221) and the workspace foundation
(#218). It adapts the reference dashboard's reusable worklist and review patterns
within **Quiet Precision**; no reference-project source, theme, or backend is
imported. Shared Accounting compositions use the existing EntityTable engine,
semantic tokens, typography and responsive controls rather than a parallel shell.

- Invoice and bill worklists now share search, currency/status/queue filters,
  named local views, column choices and scoped CSV export. Preferences are scoped
  by organization, company, user and document kind; anonymous scope is volatile.
  Canonical URL filters remain authoritative. Unreadable sources hide cached rows
  and totals; exports retain currency context even when the currency column is
  hidden. Identifiers stay exact through selection and navigation.
- Posted customer invoices and credit notes have an explicit email review step:
  recipient, eligible literal template, acknowledgement and queue confirmation.
  The existing queue reducer atomically validates the tagged review's exact
  scope, template content and invoice revision before inserting. Unknown outcomes
  retain the original request for read-only inspection and never auto-retry.
  This is **queue-only**: no organization-wide dispatch, editable per-send message,
  placeholder interpolation, PDF attachment or recipient-delivery claim.
- The bank workbench replaces raw numeric-ID reconciliation entry with scoped
  records, canonical document links, signed totals, exact-match review and an
  explicit confirmation. It requires known currency precision, posted eligible
  ledger lines and a fully readable Open statement. Unknown outcomes lock competing
  edits and retain the original scope for read-only recovery. The existing reducer
  **links bank records only**; it does not settle invoice/payment/ledger balances.
  FX, partial matches, write-offs and automatic rule application remain excluded.
- Invoice snapshot V2 captures the linked customer's legal name, address, tax and
  registration details, email and phone. Draft previews preserve the captured
  buyer; posting refreshes it from the canonical scoped customer. Issued documents
  never substitute current CRM data. V1 remains readable with an explicit missing
  billing-details notice. API/PDF and shared UI readers support both versions;
  deploy these readers before or with producers that emit V2. No table or reducer
  signature changes, generated-contract release or data backfill are required.
- Responsive coverage adds the actual shared worklist, email review, bank
  workbench and V1/V2 paper document to the synthetic browser fixture at 320,
  390, 768 and 1440px. Table scrolling stays inside its panel; controls wrap and
  primary touch targets are 44px. The fixture does not prove authentication,
  real queue execution, database authorization or PDF-worker execution.

Existing command transport cannot represent write identifiers above JavaScript's
safe integer range. Those writes fail explicitly before dispatch, rather than
rounding; readable identifiers and links retain full u64 precision. Existing
untagged mail callers remain compatible. Delivery metadata now preserves review
correlation when the dispatcher marks a message sent; that state is not proof
that the recipient received or opened it.

Remaining accounting work is separate: collections/reminders, bill and receipt
intake, close/report workflows, per-send content and attachments, multilingual
templates, richer printable custom fields and actual accounting settlement.
Parent-stack CI failures and configured-stack runtime checks remain merge gates;
synthetic component tests must not be presented as equivalent evidence.

Local verification for this batch: 699 shared UI tests, 395 web unit tests,
34 Accounting model/record checks, 13 shared personalization tests, four bank
readback tests and 38 isolated exact-source Rust helper tests passed. UI/web
TypeScript checks, the production Next build, API library compilation and module
production/test-target compilation passed. The Rust helper harness does not
execute database reducers; the module test-target check compiles but does not run
configured-stack scenarios. i18n and browser-operation transport checks passed.
Removing an unused legacy bank-state helper lowered the tracked opaque-record
baseline by one (2340 to 2339); no baseline or allowlist was raised.

### Financial dashboard restoration — Accounting

The workflow-first Accounting desk now also carries a visual financial layer;
the operational queues are retained, not replaced. Three linked sections expose
Financial overview, Accounting insights and Action queues, with 44px section
links for narrow screens.

- Financial overview separates current posted invoice/bill residuals from
  selected-period posted amounts and prior-period percentage comparisons.
  Rolling 30/90/180 UTC-calendar-day windows include today in progress. Historical
  residuals are not reconstructed from today's balance; zero prior baselines
  are explicitly unavailable rather than infinite growth.
- Shared area/bar dashboard widgets render monthly posted invoice/bill amounts,
  current AR/AP aging, and canonical budget planned versus actual. Invoice/bill
  measures exclude credit notes and are not recognized revenue, expenses, net
  ledger balances or cash flow. Whole eligible budgets
  overlapping the period are shown without proration, in the company's confirmed
  base currency only.
- Each view has one exact currency ID, authoritative decimal precision and
  minor-unit arithmetic; currencies are never combined or inferred from labels.
  Unknown scope, redacted fields, unsafe totals and non-ready reads hide affected
  figures, charts and exports instead of showing reassuring zeros or stale data.
  Independent sources remain independently available.
- Charts inherit Quiet Precision and the existing dark/Ocean palettes through
  the shared renderer and chart tokens. Readable data tables accompany the charts;
  CSV/PNG exports use existing helpers with company/currency/basis provenance.
  Budget charts and chart exports show the first eight eligible budgets by name
  with explicit scope metadata; the scrollable data table retains every budget.
  Invoice/bill links retain the selected currency's canonical filter.
- Existing overdue, draft-review, bank-line matching and monthly document-count
  views remain present. No financial writes, backend contract changes or new
  deployment are part of this dashboard restoration.

Restoration verification: all 92 isolated browser cases passed (6.9 minutes,
exit 0), retaining the prior 80 cases and adding 12 financial cases across
320/390/768/1440px. Financial cases also check currency/period/company changes,
CSV scope, dark chart tokens, 44px controls, no page overflow, unavailable-source
invalidation, no browser runtime errors and no unexpected ERP API requests.
Shared UI passed 700 tests (113 files), web unit passed 395, and Accounting
model/record checks passed 47. UI/web TypeScript, production Next build, focused
lint, i18n keys/duplicates, operation transport and whitespace checks passed;
opaque-record debt remained 2339/2339. Desktop/mobile light/dark screenshots
were visually inspected. These are synthetic component checks, not authenticated
backend or deployment verification; existing rollout and merge gates still apply.

### Shared overview presentation — Sales, CRM, Purchasing, Reports and Expenses

The Accounting restoration's visual language now extends to five additional
modules through one `ModuleInsights` composition and an optional `ModuleView`
dashboard-content slot. The slot owns its currency/period controls and scoped
chart exports; it replaces legacy dashboard figures rather than adding another
layer of contradictory dollar totals. Other tabs and modules without the slot
retain their existing behavior. Shared chart renderers, workspace surfaces,
theme tokens, native controls, 44px targets and scroll-contained data tables
carry Quiet Precision across desktop, mobile, dark and Ocean appearances.

Each overview has current-state summary tiles, separate 30/90/180-day UTC
activity comparisons, monthly area and horizontal state-count charts, exact
record action queues, recent-record links and retained create/workspace actions.
The measures remain specific to the canonical source:

- Sales: draft/sent quotation value and confirmed/completed order value by
  order date. Not recognized revenue, invoice AR or cash received.
- CRM: explicitly company-assigned open opportunity expected value and
  creation cohorts currently open/won. Not weighted commitments or historical
  pipeline snapshots; organization-level unassigned opportunities are excluded.
- Purchasing: open confirmed PO value and confirmed/completed PO value by
  order date, with late unreceived-order review. No inferred on-time rate,
  billed-spend or cash-paid claims.
- Expenses: report-header values only, excluding draft/refused reports from
  period activity; submitted claims remain a current-state queue. Lines are not
  added to report headers. Operations remains the receipt/card path. The new
  overview does not link to the existing unimplemented Inbox tab; exposing that
  separate panel requires its own scope/read-state/action-safety work.
- Reports: report-header creation and current outcome counts, with distinct
  draft/prepared-output measures. No cross-period report snapshots, currencies
  or trial-balance rows are summed as financial totals. Statements, trial
  balances, schedules and saved dashboards remain separate workspaces.

Money uses one exact currency ID, authoritative decimal precision and safe
minor-unit arithmetic. Company/org boundaries, exact u64 links, unknown fields,
missing dates, zero baselines and unavailable sources are explicitly handled.
Affected figures/exports/queues discard cached data on loading, denial, failure
or partial reads; independent count measures can remain available when only
amount fields are unreadable. Activity is grouped by creation/order date and
current eligible state, not reconstructed as a past-state/event-time series.
Queue previews show up to five exact records; complete workspaces remain linked.
Charts export source/basis/company/currency/window metadata through existing
helpers. Shared area gradients now have instance-unique SVG-safe IDs rather
than translated labels, and count axes support whole-number ticks. Sales retains
direct operational queue links without legacy unscoped totals. The existing CRM
forecast action uses the new selected period, while retaining its canonical
company scope independently of the analysis currency.
The shared model suite is registered in frontend CI. No backend, permission,
schema, new financial-command or deployment changes are included.

Verification on runtime commit `72cf9e231103245662d866b321118796b6e18607`:
all **112/112** isolated browser cases passed (13.2 minutes, exit 0), retaining
the existing 92 cases and adding 20 module cases across 320/390/768/1440px.
New cases exercise currency/period/company changes, exact queue links, scoped
CSV metadata, source invalidation, period callbacks, retained workspaces/actions,
long unbroken names, 44px exports, whole-count ticks, valid SVG gradient references,
dark/Ocean tokens, no page overflow, no runtime errors and no unexpected ERP API
requests. No assertion or timeout was weakened. The synthetic previous-period
fixture date was corrected before the source freeze.

Shared UI passed **706 tests / 113 files**, web unit passed **395**, and combined
Accounting/overview model-record checks passed **65**. UI/web TypeScript,
production Next build, focused shared/new-code lint, i18n checks, operation
transport and whitespace checks passed; opaque-record debt stayed **2339/2339**.
Integration-file lint has the same **11 unused-import errors and seven warnings**
as base commit `3ee0fbaf`; these are not new failures or a clean repository-wide
lint claim. Desktop/mobile captures for every module and dark/Ocean captures were
visually inspected. Verification uses production components with synthetic inputs,
not authenticated operations, live forecast capture or backend/deployment checks.
The existing PR-stack, review and authenticated CI gates remain applicable.

### 1. Rebuild the application shell and navigation

- Replace the seven-group, 25-destination sidebar with:
  - `Home`
  - `My Work`
  - role-relevant pinned modules
  - collapsible `All modules`
  - `Recent` and `Favorites`
- Group modules around business workflows rather than technical categories:
  - Sell: CRM, proposals, sales, subscriptions, POS
  - Buy and operate: purchasing, inventory, manufacturing, IoT
  - Finance: accounting, expenses, reports
  - People and delivery: HR, projects, tasks, calendar
  - Service and knowledge: helpdesk, messages, documents
  - Automation: approvals, workflows, AI drafts, AI skills
- Move Forensics, Trackers, Maps, system administration, and AI harness tooling out of primary navigation unless the current role uses them frequently.
- Keep the company switcher persistent and show the active company beside page titles when records are company-scoped.
- Add global command search for modules, records, saved views, and actions; expose its keyboard shortcut visibly.
- Persist collapsed navigation, favorites, recent destinations, and role-specific landing preferences.

This follows established navigation guidance: frequent and important destinations should appear first, with related destinations grouped and secondary hierarchy handled contextually rather than as one flat list. [Material navigation drawer guidance](https://m2.material.io/components/navigation-drawer), [Material navigation hierarchy](https://m2.material.io/design/navigation/understanding-navigation.html).

### 2. Introduce two personalized home experiences

#### Owner command center

- Replace generic KPI grids with five sections:
  - `Needs attention`: overdue invoices, breached SLAs, stockouts, blocked production, late purchase orders, overdue tasks.
  - `Approvals`: human approvals and AI action drafts in one queue.
  - `Today`: calendar, operational deadlines, cash events, and assigned follow-ups.
  - `Business pulse`: revenue, cash, margin, pipeline, inventory risk, with comparison period and data freshness.
  - `Continue working`: recent records, saved views, and unfinished drafts.
- Every metric must support a direct drill-down into the filtered records behind it.
- Show concise explanatory context such as “12 invoices overdue, $48k exposed,” not isolated totals.
- Rank exceptions by urgency and financial or operational impact.
- Allow users to acknowledge, assign, approve, or resolve common exceptions inline.

#### Specialist home

- Generate defaults from role and permission data:
  - Accountant: close checklist, unreconciled transactions, overdue receivables, draft entries.
  - Sales: follow-ups due, pipeline risks, quotes awaiting response, stalled opportunities.
  - Inventory: replenishment queue, stockouts, transfers, counts requiring action.
  - Purchasing: requisitions, late POs, vendor exceptions, receipts.
  - Manufacturing: blocked orders, work-center load, quality exceptions.
  - HR: leave approvals, contract expirations, payroll readiness.
  - Support: assigned and SLA-risk tickets.
  - Project users: assigned work, overdue tasks, milestones, timesheets.
- Let users pin or hide widgets without requiring them to construct dashboards from scratch.
- Use progressive disclosure: surface health and exceptions first, with dense grids available after drill-down. This reduces recall burden and follows the established “overview first, details on demand” pattern. [Nielsen Norman heuristic workbook](https://media.nngroup.com/media/articles/attachments/Heuristic_Evaluation_Workbook_-_Nielsen_Norman_Group.pdf), [Nielsen Norman application dashboard example](https://media.nngroup.com/media/reports/free/Application_Design_Showcase_1st_edition.pdf).

### 3. Replace tab overload with workspace navigation

- Do not render more than 5–7 primary horizontal tabs.
- Use three navigation levels:
  - Sidebar: business area.
  - Module sub-navigation: jobs or workspaces.
  - Local tabs: alternate views of the same job.
- Convert secondary setup entities into local settings, drawers, or overflow navigation.
- Preserve direct URLs and browser history for every workspace and saved view.
- Recommended restructuring:
  - Accounting: Overview, Receivables, Payables, Ledger, Banking, Planning, Close; move taxes, fiscal periods, analytic structures, intercompany, and account configuration into contextual sub-navigation.
  - Sales: Pipeline, Orders, Fulfillment, Returns, Pricing; move carriers, payment methods, loyalty, and shipping configuration under Sales settings.
  - Inventory: Stock, Products, Operations, Replenishment, Traceability, Quality, Configuration.
  - Reports: Library, Financial reports, Dashboards, Scheduled, Explore; keep query builder and pivot explorer as views within Explore.
  - HR: People, Time off, Payroll, Recruitment, Organization.
  - IoT: Monitor, Devices, Actions, Alerts, Configuration.
  - All smaller modules: Overview plus no more than four primary operational workspaces.

### 4. Standardize list and record layouts

#### Lists

- Use one consistent toolbar containing:
  - search
  - saved view selector
  - prioritized filters
  - sort
  - column controls
  - export
  - primary create action
- Move “New” from a detached right-aligned row into the page header or list toolbar.
- Display the record count and applied filters as removable chips.
- Store search, filters, sorting, visible columns, and page in URL parameters so views survive refresh, sharing, and back navigation.
- Support multi-select filters where business states are not mutually exclusive.
- Add saved team and personal views such as “My overdue invoices” or “High-value opportunities with no activity.”
- Use table density controls for specialists while retaining a comfortable default.
- Keep identifiers, status, responsible person, due date, and amount visually stable across comparable tables.
- Use sticky headers, sticky primary identifiers, right-aligned numeric columns, semantic status badges, and visible row actions.
- Replace client-only fixed pagination with server-backed pagination or virtualization for large datasets.

Applied-filter visibility and persistent filter state materially reduce disorientation. [Baymard applied-filter research](https://baymard.com/blog/how-to-design-applied-filters), [Baymard filtering guidance](https://baymard.com/learn/ecommerce-filter-ui), [Material data-table guidance](https://m2.material.io/design/components/data-tables.html).

#### Records

- Replace generic record sheets with a consistent record workspace:
  - identity and status header
  - primary next action
  - key facts summary
  - workflow or lifecycle progress
  - related records
  - activity, messages, and audit history
- Use full-page records for complex entities such as invoices, orders, projects, proposals, manufacturing orders, and tickets.
- Reserve sheets for quick preview or lightweight edits.
- Keep high-frequency state transitions visible; place destructive and administrative actions in an overflow menu.
- Show relationships as recognizable names with links, not opaque IDs.
- Add unsaved-change protection, optimistic feedback where safe, and plain-language failure recovery.

### 5. Make empty, loading, and onboarding states productive

- Expand onboarding beyond organization creation:
  - choose role and primary goals
  - configure or import initial data
  - complete 3–5 role-specific setup tasks
  - arrive at a populated, explainable home
- Add sample-data mode or guided import paths for users without operational data.
- Every empty state should explain:
  - why the page is empty
  - what the entity enables
  - the recommended first action
  - optional import or template action
- Distinguish “no records yet,” “no filter matches,” “not permitted,” and “failed to load.”
- Use shadcn `Empty`, `Alert`, `Skeleton`, `Progress`, `Field`, `FieldGroup`, and `InputGroup` consistently instead of custom placeholders and form wrappers.
- Remove dashboards filled with static `0`, `$0`, or `—`; show a loading state, a real value, or an explicit setup state.
- Provide lightweight contextual feature discovery instead of global tours. Atlassian recommends choosing messages by intent and using empty states to explain what users can do next. [Atlassian message guidance](https://atlassian.design/foundations/content/designing-messages/), [Atlassian empty states](https://atlassian.design/components/empty-state).

### 6. Module-specific priorities

- CRM and Sales: unify the lead-to-cash journey, emphasize next activity and stalled records, and connect opportunities → proposals → orders → invoices.
- Purchasing and Inventory: provide a procure-to-stock workspace connecting requisitions, orders, receipts, stock movements, and vendor exceptions.
- Accounting and Expenses: emphasize close readiness, reconciliation, collections, approvals, and traceability from source transaction to ledger.
- Manufacturing and IoT: lead with live operational health, blocked work, quality issues, downtime, and device alerts rather than configuration tables.
- Projects, Tasks, Calendar, and HR: converge assigned work into `My Work`; retain specialist planning views inside each module.
- Helpdesk and Messages: adopt an inbox layout with queue navigation, conversation/detail content, and contextual customer or record information.
- Documents and Knowledge: prioritize recent, shared, and relevant content; use folders as one navigation aid rather than the primary mental model.
- Reports and Forensics: separate curated decision-ready reports from expert analysis tools.
- Proposals: retain the richer dedicated workspace and use it as the reference model for other complex record workflows.
- POS and Map: keep purpose-built layouts; connect their outputs and alerts back to the command center.
- Workflows, Approvals, and AI drafts: unify pending decisions in one governed inbox while retaining separate administration screens.
- Settings: organize by Organization, People and access, Finance, Operations, Integrations, Automation, and Developer settings; add search.

### 7. Shared shadcn design-system work

- Create shared compositions rather than module-specific layout implementations:
  - `WorkspaceHeader`
  - `WorkspaceNav`
  - `ActionQueue`
  - `EntityToolbar`
  - `AppliedFilters`
  - `SavedViewSelector`
  - `RecordHeader`
  - `RecordSummary`
  - `ActivityPanel`
  - `MetricWithContext`
- Refactor forms toward shadcn `FieldGroup` and `Field`, with consistent descriptions, validation, required markers, and sectioning.
- Replace custom table/view toggles with `ToggleGroup`.
- Use `Badge` variants and semantic tokens for statuses; do not use decorative color as the only status signal.
- Use the complete `Card` composition for dashboard widgets, but avoid wrapping every table in another card when the page already supplies a surface.
- Standardize desktop, tablet, and mobile behavior:
  - persistent sidebar on desktop
  - modal navigation on smaller screens
  - table-to-card or priority-column adaptations on mobile
  - bottom drawers for mobile record previews and filters

### 8. Retention measurement and rollout

- Define activation by role, not merely signup:
  - owner views an exception and completes an action
  - specialist creates or processes a core record
  - user saves or revisits a view
- Add PostHog events for:
  - home widget interaction
  - exception drill-down and resolution
  - command-palette usage
  - search and filter success
  - saved-view creation and reuse
  - workflow completion time
  - empty-state action
  - module return frequency
- Track:
  - time to first meaningful action
  - weekly users completing a core workflow
  - repeated use of saved views
  - unresolved exception age
  - navigation backtracking
  - zero-result searches and filters
  - 7-day and 30-day return rate by role
- Roll out in four releases:
  1. Navigation, command center, analytics instrumentation.
  2. Shared list toolbar, filters, saved views, and record headers.
  3. Accounting, Sales/CRM, Inventory/Purchasing workflow restructuring.
  4. Remaining specialist modules, onboarding, and personalization.
- Feature-flag the shell and module navigation changes; preserve existing deep links through redirects or compatibility routes.

## Test Plan

- Task-based usability tests with owners and at least one specialist from Finance, Sales, and Operations.
- Verify users can locate and act on an urgent exception without knowing its source module.
- Verify specialists can reach frequent records and saved views in fewer interactions than the current UI.
- Test sidebar comprehension, module tree finding, and command search with first-time users.
- Test list filtering, filter removal, browser back, refresh, deep-link sharing, and zero-result recovery.
- Test keyboard navigation, screen-reader labels, focus restoration, contrast, zoom, and reduced motion.
- Test desktop, tablet, and mobile layouts for every shared workspace composition.
- Add visual regression coverage for the shell, owner home, specialist home, standard list, empty state, and record workspace.
- Compare feature-flag cohorts using workflow completion, return rate, and navigation backtracking.

## Assumptions

- Both owners and functional specialists are first-class audiences; role-based defaults are preferred over one compromised universal dashboard.
- The existing Next.js, Tailwind 4, and `@lumiere/ui` shadcn architecture remains in place.
- Existing permissions remain authoritative for navigation, data, and actions.
- Backend entities and reducers remain compatible; this is primarily an information-architecture and presentation redesign.
- Mobbin was requested but was unavailable in the active MCP tools and connector catalog during this investigation. No Mobbin-specific evidence is claimed; recommendations use the source audit and cited UX research instead.
