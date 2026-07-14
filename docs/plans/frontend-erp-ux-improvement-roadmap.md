# Lumière ERP UX Improvement Roadmap

## Summary

The frontend has strong functional coverage and a reusable shadcn-based component layer, but its information architecture mirrors backend entities more than user goals. The clearest example is horizontal tab overload: Accounting and Inventory expose roughly 20 entity tabs each, while Sales exposes about 15. Users must remember where data lives instead of following recognizable workflows.

The redesign should support both owners and specialists through role-personalized defaults:

- Owners land on a cross-functional command center focused on exceptions, trends, approvals, and next actions.
- Specialists land in role-specific workspaces optimized for frequent operational workflows.
- Everyone retains access to the complete module catalog through navigation and command search.

The highest-value shift is from “module → dashboard → many entity tabs” to “role → job to be done → actionable queue → record.”

## Key Changes

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
