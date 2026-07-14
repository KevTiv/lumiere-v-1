# Lumière ERP Inclusive UX and Assisted-Completion Roadmap

## Summary

Redesign Lumière for three first-class audiences:

- Owners and operators who need a cross-functional command center.
- Functional specialists who need fast, information-dense workflows.
- Emerging-market users who may work primarily from affordable Android devices, experience intermittent connectivity, use a second language, or have limited familiarity with formal ERP concepts.

The experience should optimize for successful completion, not merely feature discovery. Tedious workflows will become guided, resumable journeys with visible progress, sensible defaults, contextual help, and immediate evidence that the user’s work has value.

The first release will be a market-neutral pilot. Shared foundations will support localization, local currencies, low-bandwidth use, and culturally adaptable content, while country-specific language, payment, tax, and workflow assumptions will be validated before each rollout.

Native Expo will be the primary mobile channel. The responsive web application remains the specialist and administration surface.

## Product Principles

- Organize around user goals—sell, collect, restock, approve, pay—not database entities.
- Show the next useful action instead of making users interpret raw data.
- Ask only for information needed at the current step.
- Save progress continuously and make interruption safe.
- Use plain language first; expose technical terminology only where specialists need it.
- Explain the consequence of actions before asking for confirmation.
- Give users visible evidence of progress, competence, and business value.
- Treat low bandwidth, small screens, shared devices, and interrupted sessions as normal operating conditions.
- Adapt defaults by role, company, market, and prior behavior without hiding the full system.

## Key Changes

### 1. Role- and device-aware application structure

#### Web

- Replace the current 25-destination primary sidebar with:
  - Home
  - My Work
  - Favorites
  - role-relevant modules
  - collapsible All Modules
  - Recent
- Group modules by recognizable business outcomes:
  - Sell and get paid
  - Buy and restock
  - Manage money
  - Deliver work
  - Support customers
  - Manage people
  - Automate and approve
- Move expert tools such as Forensics, Trackers, query builders, AI harnesses, and advanced configuration out of default navigation.
- Preserve complete access through role-aware navigation and command search.

#### Native Expo

- Replace the starter application with five primary destinations:
  - Home
  - My Work
  - Create
  - Activity
  - More
- Limit mobile navigation to frequent field and approval workflows. Do not reproduce every web module.
- Make `Create` a task launcher for common outcomes such as:
  - record a sale
  - add a customer
  - capture an expense
  - receive stock
  - count inventory
  - create a task
  - approve a request
- Use native bottom sheets, large touch targets, barcode/camera capture, share intents, and platform date/number input.
- Preserve role, company, and work context between sessions.

This retains a coherent hierarchy while placing frequent destinations first, consistent with established navigation guidance. [Material navigation drawer guidance](https://m2.material.io/components/navigation-drawer), [Material navigation hierarchy](https://m2.material.io/design/navigation/understanding-navigation.html).

### 2. Personalized owner and specialist homes

#### Owner command center

Present an actionable business narrative:

- `Needs attention`: overdue money, low stock, late orders, blocked production, breached SLAs.
- `Approvals`: human and AI-assisted decisions in one queue.
- `Today`: deadlines, deliveries, expected payments, meetings, and follow-ups.
- `Business pulse`: revenue, available cash, margin, pipeline, and inventory risk.
- `Continue`: unfinished drafts, recent records, and saved workflows.

Metrics must include:

- a plain-language interpretation
- comparison with a meaningful previous period
- freshness or synchronization status
- a direct action or drill-down
- local currency and number formatting

Example: replace “Accounts receivable: 48,200” with “$48,200 is still unpaid. $12,400 is overdue—review 7 customers.”

#### Specialist home

Generate a default workspace from role and permissions:

- Accountant: close checklist, unreconciled transactions, overdue receivables.
- Sales: today’s follow-ups, stalled opportunities, unanswered proposals.
- Inventory: stockouts, pending receipts, counts, replenishment.
- Purchasing: requisitions, late POs, vendor exceptions.
- Manufacturing: blocked orders, quality issues, work-center load.
- HR: leave approvals, expiring contracts, payroll readiness.
- Support: assigned tickets and SLA risk.
- Projects: assigned work, overdue tasks, milestones, missing timesheets.

Users can personalize the workspace, but Lumière supplies a useful default. Progressive disclosure keeps the overview understandable while preserving expert drill-down. [Nielsen Norman heuristic workbook](https://media.nngroup.com/media/articles/attachments/Heuristic_Evaluation_Workbook_-_Nielsen_Norman_Group.pdf).

### 3. Assisted completion for tedious workflows

Introduce a shared `GuidedTask` pattern for imports, setup, reconciliation, stock counts, purchase and sales documents, expenses, payroll, reporting, and approvals.

Each guided task must provide:

- A short outcome-oriented title: “Receive today’s delivery,” not “Create stock picking.”
- An estimate such as “About 3 minutes” or “4 details remaining.”
- A visible step indicator using descriptive labels rather than only numbers.
- One decision group per step.
- Pre-filled company, currency, date, warehouse, account, and responsible user where safely inferable.
- Searchable human-readable choices instead of numeric IDs.
- Inline examples and “Why we ask” explanations for unfamiliar fields.
- Automatic draft saving after meaningful changes.
- Explicit `Save and finish later`.
- A final review written in natural language.
- Clear confirmation of what changed and what happens next.
- A direct next action after completion.

Long forms should be divided by user intent:

1. Essentials required to produce a valid draft.
2. Optional details that improve accuracy.
3. Review and confirm.
4. Completion with visible business effect.

Do not use artificial rewards, streaks, or celebratory interruption for serious financial work. Investment should come from meaningful progress:

- completed setup percentage
- records cleaned or imported
- money collected
- stock accuracy improved
- tasks removed from the queue
- time estimated to have been saved

### 4. Motivation, trust, and user investment

- Add a persistent `Getting started` path tailored to role:
  - create or import first customer/product
  - complete first transaction
  - invite a teammate
  - review first business insight
- Show a useful result after every setup step, rather than requiring full configuration before value appears.
- Use progressive commitment:
  - let users create drafts with minimum information
  - request advanced accounting or operational fields when posting or approving
- Explain irreversible and financially sensitive actions with:
  - what will change
  - who will see it
  - whether it can be undone
  - the expected accounting or stock effect
- Provide undo where technically safe and a clear correction path elsewhere.
- Show synchronization and submission states explicitly:
  - saved on device
  - waiting to sync
  - syncing
  - submitted
  - requires attention
- Avoid generic “Success” messages. Confirm the actual outcome: “Expense saved and sent to Ama for approval.”
- Give users a personal activity record showing completed work and its effect.
- Let supervisors acknowledge useful work without turning the ERP into a competitive leaderboard.
- Never use shame, loss-framing, deceptive urgency, or forced gamification.

### 5. Offline-first native architecture

Implement a local-first task layer for selected mobile workflows:

- Cache role, company context, reference lists, assigned work, recent records, and lightweight dashboard summaries.
- Store in-progress drafts locally with an explicit synchronization state.
- Queue authorized create/update operations while offline.
- Synchronize automatically when connectivity returns.
- Use idempotency keys so retries cannot create duplicate transactions.
- Display pending operations in an understandable outbox.
- Allow users to inspect and retry failed operations.
- Detect conflicts and present a human-readable comparison; never silently overwrite remote changes.
- Require online confirmation for high-risk operations such as posting journal entries, approving payments, destructive actions, or final payroll processing.
- Compress uploaded images and documents before transmission, while retaining adequate legibility.
- Defer nonessential charts, avatars, previews, and large reference datasets.
- Provide a low-data mode that disables automatic media loading and reduces background refresh.

Offline support will initially cover:

- assigned tasks
- contact creation and notes
- expense capture with receipt
- stock count capture
- goods receipt drafts
- sales and purchase draft capture
- approvals previously downloaded to the device

Complex configuration, reporting, reconciliation, and final accounting operations remain web-first and online.

### 6. Localization and local comprehension

The current English-only resource should become a locale framework with:

- translation namespaces by module
- locale-aware number, currency, percentage, date, and time formatting
- pluralization
- right-to-left readiness
- configurable first day of week
- local address and telephone formats
- translated validation, errors, notifications, and offline states
- content-length resilience for longer translations

For each launch market:

- Validate terminology with working users, bookkeepers, and operators.
- Choose one primary language and one fallback language.
- Support switching language without losing form progress.
- Prefer familiar local terms while retaining the formal ERP term as secondary help where necessary.
- Avoid acronyms and accounting jargon in owner-facing screens.
- Use examples based on local business patterns, currencies, payment methods, and document conventions.
- Let organizations rename selected concepts where local usage differs.
- Never infer literacy, expertise, or ability from a country or language.

Country-specific mobile money, tax, identity, and invoicing functionality must be separately scoped and validated. A generic “emerging market” profile must not hard-code assumptions across countries.

### 7. Standardize lists and records

#### Lists

Use a consistent web toolbar with:

- search
- saved views
- prioritized filters
- applied-filter chips
- result count
- sort and column controls
- export
- primary create action

Additional behavior:

- Persist search, filter, sorting, and page state in URLs.
- Support personal views such as “Customers I need to contact today.”
- Use server-backed pagination or virtualization for large datasets.
- Keep identifiers, status, owner, due date, and amount visually stable.
- Provide comfortable and compact density modes.
- Translate backend state names into plain-language statuses.

On mobile:

- Use task-focused cards instead of horizontally scrolling desktop tables.
- Place the primary identifier, status, amount, and next action first.
- Load records incrementally.
- Keep filter controls in a bottom sheet with an explicit result count.

Visible applied filters reduce disorientation and simplify recovery. [Baymard applied-filter research](https://baymard.com/blog/how-to-design-applied-filters), [Baymard filtering guidance](https://baymard.com/learn/ecommerce-filter-ui).

#### Records

Use a consistent record workspace:

- identity and status
- primary next action
- key facts
- lifecycle progress
- related records
- activity and messages
- audit history

Complex invoices, orders, projects, proposals, manufacturing orders, and tickets use full-page web workspaces. Sheets are reserved for previews and lightweight editing.

### 8. Reduce module and tab complexity

Do not expose more than 5–7 primary tabs in a workspace.

- Accounting: Overview, Receivables, Payables, Ledger, Banking, Planning, Close.
- Sales: Pipeline, Orders, Fulfillment, Returns, Pricing.
- Inventory: Stock, Products, Operations, Replenishment, Traceability, Quality, Configuration.
- Reports: Library, Financial, Dashboards, Scheduled, Explore.
- HR: People, Time off, Payroll, Recruitment, Organization.
- IoT: Monitor, Devices, Actions, Alerts, Configuration.
- Other modules: Overview plus no more than four primary operational workspaces.

Move setup entities into contextual settings. Preserve deep links and expert access.

### 9. Shared UI interfaces and components

Add shared web compositions to `@lumiere/ui`:

- `WorkspaceHeader`
- `WorkspaceNav`
- `ActionQueue`
- `EntityToolbar`
- `AppliedFilters`
- `SavedViewSelector`
- `RecordHeader`
- `RecordSummary`
- `GuidedTask`
- `TaskProgress`
- `CompletionSummary`
- `SyncStatus`
- `ResumeTaskCard`
- `MetricWithContext`

Add equivalent native primitives to the existing native UI export:

- `NativeTaskCard`
- `NativeGuidedTask`
- `NativeRecordSummary`
- `NativeSyncBanner`
- `NativeOutbox`
- `NativeEmptyState`
- `NativeActionSheet`

Define shared application types:

- `UserExperienceProfile`: role, locale, market, preferred density, low-data preference.
- `GuidedTaskDefinition`: steps, required data, resume policy, risk level, online requirements.
- `DraftSyncState`: local, queued, syncing, synced, conflicted, failed.
- `ActionOutcome`: changed records, next state, responsible person, next recommended action.
- `SavedWorkspaceView`: module, filters, sort, columns, owner, visibility.

Forms should consistently use shadcn `FieldGroup`, `Field`, `InputGroup`, `Progress`, `Alert`, `Empty`, `Skeleton`, and semantic `Badge` variants.

### 10. Rollout

1. Foundation:
   - role and experience profiles
   - navigation redesign
   - localization architecture
   - assisted-task interfaces
   - completion and retention analytics
2. Native core:
   - replace Expo starter
   - authentication and company context
   - Home, My Work, Create, Activity, More
   - local draft store, outbox, synchronization states
3. High-value journeys:
   - expenses
   - contacts and follow-ups
   - stock counts and receipts
   - purchase/sales drafts
   - approvals
4. Web restructuring:
   - owner and specialist homes
   - shared list and record layouts
   - Accounting, Sales/CRM, Inventory/Purchasing workspaces
5. Pilot:
   - select one country and two business profiles
   - translate the validated core journeys
   - conduct field testing on representative low-cost Android devices and networks
6. Expansion:
   - address pilot findings
   - add country-specific payment, tax, and document behavior
   - extend native workflows only when usage evidence supports them

## Test Plan

- Recruit owners, specialists, first-time ERP users, second-language users, and users working primarily from lower-cost Android devices.
- Run task-based tests for:
  - first organization setup
  - first sale or purchase draft
  - receipt capture
  - stock count
  - approval
  - resuming an interrupted workflow
- Test on slow, unstable, and offline connections.
- Verify queued operations cannot create duplicates.
- Test conflict handling, retry, logout, company switching, token expiry, and shared-device privacy.
- Verify every long task can be safely interrupted and resumed.
- Measure whether users understand:
  - what is required
  - why it is required
  - whether work is saved
  - what will happen after submission
- Test translations for comprehension rather than literal equivalence.
- Test text expansion, right-to-left layout readiness, screen readers, keyboard access, contrast, zoom, and large text.
- Compare current and redesigned flows using:
  - completion rate
  - completion time
  - abandonment by step
  - validation-error frequency
  - resumed-task completion
  - synchronization failure rate
  - support requests per workflow
  - 7-day and 30-day return rates

## Assumptions

- Emerging-market users are diverse; the product will provide adaptable foundations and validate country-specific behavior through a pilot.
- The pilot is market-neutral until a launch country is selected.
- Native Expo is the primary phone-first investment; the web remains the complete specialist and administrative application.
- Offline mutation is limited to explicitly approved, idempotent workflows.
- High-risk financial and destructive operations require online confirmation.
- Existing Next.js, React, Tailwind, shadcn, SpacetimeDB, permissions, and reducer contracts remain foundational.
- User investment will be built through competence, saved effort, continuity, and visible business outcomes—not manipulative gamification.
- Mobbin was unavailable in the active MCP environment during this investigation; no Mobbin-specific research is claimed.
