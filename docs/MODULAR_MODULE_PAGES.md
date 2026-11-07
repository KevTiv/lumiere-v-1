# Modular module pages

## Interaction

Each business module exposes **Edit page** for the current page or tab. The
editor offers **Add widget**, drag and keyboard ordering, width presets,
remove, undo/redo, reset, cancel and **Done**. Changes remain a local draft
until Done saves the page. Unsaved changes participate in the existing
navigation guard.

The gallery separates built-in page blocks and reusable saved widgets. Users
can search, choose a width and add a placement. Charts with loaded data have a
preview; unloaded saved charts explain that their data loads on placement.
Trusted native content blocks use a noninteractive gallery preview.

**Create new widget** opens the existing Reports query builder in a sheet on
the current module. Users choose the source, metric/aggregation, filters,
grouping, date field, chart style or table columns, and inspect the preview.
**Save and add to page** creates the reusable definition through its existing
idempotent native command, reads back its canonical identity, and stages the
placement. Done then persists the layout. Closing or cancelling a layout
does not delete a saved reusable definition.

Configure is available for saved definitions that the query builder can
faithfully represent. It creates a new definition and replaces only this
page's placement. It does not rewrite other pages' reusable charts. A built-in
block can appear once on a page; a saved widget can have multiple independent
placements. Widths are quarter, third, half, wide and full, using the shared
twelve-column responsive grid.

The assistant's **Edit this page**, **Add a chart** and named saved-widget
actions enter this same editor. A known widget is staged directly. An unknown
or new metric request opens the gallery with the user's request, then the
native builder. The model does not generate executable UI, arbitrary queries
or persist a layout without the user selecting Done.

## Coverage

The Rust-generated `PersonalPageModule` enum owns the business-module inventory.

| Host                                      | Modules/pages                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared `ModuleView`                       | Accounting, Sales, CRM, Inventory, Products, Warehouse, Purchasing, HR, Manufacturing, Projects, IoT, Documents, Calendar, Reports, Subscriptions, Expenses, Helpdesk, Workflows, Messages, Proposals, Fleet |
| Shared `ModuleInsights` dashboard content | Sales, CRM, Purchasing, Expenses, Reports; each metric, trend, distribution, actions and recent-record block can be arranged independently                                                                   |
| Native dashboard sections                 | Accounting: accounting desk plus five independent live financial charts. Subscriptions: needs-attention overview, two independent live subscription charts, and import controls                              |
| Dedicated dashboard hosts                 | Overview, Trackers                                                                                                                                                                                           |
| Dedicated tab host                        | POS register and administration                                                                                                                                                                              |
| Shared operational widget area            | Tasks, Approvals, Distributor, Map                                                                                                                                                                           |

`ModuleView` adds a widget area above native content on non-dashboard tabs.
Accounting retains each financial chart's source-state and currency diagnostics.
Subscriptions exposes its live charts only when its subscription source is ready.
Operational lists, record forms and workflow actions keep their native owners.
Existing workspace visibility and permissions continue to decide which modules
are available to each actor. Settings, AI administration and diagnostic routes
are outside this business-page contract.

## Implementation

- `PageComposition` owns draft interaction and renders the existing widget
  components. It has no HTTP, company or business-mutation dependencies.
- `PageCompositionHostProvider` injects the web adapter into shared module UI.
  Isolated consumers without a host retain their existing content.
- `module-page-composition.tsx` owns scope, authorized catalog/source reads,
  the query-builder sheet and assistant request delivery.
- `personal-page-layout` contains generated types, schema validation and shared
  limits. `module-page-layout.ts` is the web HTTP adapter.
- The API's dedicated personal-layout handler delegates to
  `save_personal_page_layout`, using existing immutable presentation head and
  version tables. General module publication remains a separate disabled API.

Layouts belong to the authenticated actor, organization, company, module and
page. No browser-local persistence is used in production. Every save carries
the revision captured when editing began. A conflict leaves the draft open
and asks the user to cancel/reopen from the latest saved layout. Reset writes
a new null-layout revision; an empty placement array is an intentionally
empty page.

Source reads remain independent from presentation permission. A saved widget
reference never grants access to its data. Queries carry the selected company,
their cache identity includes the actor and company, and errors do not display
stale cached rows. Cursor reads are bounded at 40 pages or 20,000 rows; incomplete
sources are marked partial instead of displaying an apparently complete total.

The RAG API constructs optional saved-widget choices from an authenticated
server query. Browser-provided widget IDs are not authority. The gateway can
return only an offered capability and optional offered widget key. The browser
checks the current catalog again, captures the page/tab and rejects stale actor
or company scope. Manual editing and assistant requests share persistence.

## Release and verification

Publish and pin the generated contracts containing the dedicated reducer, then
deploy the matching native module and API. The existing branch contracts-release
workflow supplies this atomic pin. An older pin returns 503 for saves rather
than falling through to generic operation dispatch. No table migration is needed.

Focused tests cover editor transitions and capacity, builtin uniqueness,
production-host creation/readback/reload, company changes, conflicts, generated
wire validation, query definition round trips, cursor bounds, server-authorized
assistant catalogs, and RAG JSON/SSE proposal parity. Native persisted cases are
registered in the existing `run_presentation_draft_tests` CI acceptance gate.

`tests/page-composition-ui.spec.ts` exercises the real UI through a clearly
synthetic fixture. Its localStorage adapter is test-only. That fixture does not
prove production API authorization or native persistence. Run it with the
accounting UI Playwright configuration in a browser-capable environment.
