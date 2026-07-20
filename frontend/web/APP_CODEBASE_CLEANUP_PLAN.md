# App Router Codebase Cleanup Plan

## Purpose

This plan covers every `page.tsx` route under `frontend/web/app`, the shared layouts and providers that determine page behavior, and the query-hook interfaces used to hydrate those pages. Its goals are to:

- eliminate server reads that are fetched and then discarded;
- make server-to-client query hydration reliable and mechanically verifiable;
- prevent hidden tabs from issuing unnecessary requests on initial render;
- remove production demo/sample-data fallbacks;
- reduce oversized client components and barrel-import cost;
- restore lint, type, build, and page-data contract enforcement.

The audit baseline is 39 pages, 169 TypeScript/TSX files in `app`, about 47,810 lines, and 76 client components. In direct page-client query reads, 124 of 246 reads currently receive initial data. This ratio is diagnostic only: the target is not 100% SSR. The target is 100% intentional classification as either `initial`, `deferred`, `polling`, or `event-driven`.

## Confirmed defects to fix first

- [ ] Accounting: wire `initialTaxes`, `initialAnalytic`, and `initialJournals` into the matching query cache instead of accepting and ignoring them.
- [ ] Inventory: stop fetching and discarding `initialWarehouse3dZones`; remove it from the default dashboard contract and fetch it only when the dynamically loaded 3D tab is active.
- [ ] Reports: stop fetching and dropping `saved-reports`; defer it to `PivotExplorer`, seeding it only for a validated direct deep link to that tab.
- [ ] Proposal workspace: remove the `orgId` search-parameter override; tenant scope must come only from the authenticated server session.
- [ ] Proposal workspace: replace or implement the missing `/api/proposals/analyze` endpoint before exposing the analyze action.
- [ ] Root layout: stop fetching role/company bootstrap data that is immediately fetched again by client hooks.
- [ ] Map and forensics: never substitute demo records for an authenticated tenant's empty production dataset.
- [ ] Trackers and settings: remove or isolate sample-only state so production pages do not present mock business data as live data.
- [ ] Root realtime/auth boundary: stop passing the STDB bearer into client props and persisting it in `localStorage`; the token currently documented as HTTP-only is exposed to browser JavaScript.
- [ ] Authentication telemetry: stop sending reset/invite tokens and auth errors to PostHog through full query-string pageviews.
- [ ] Invite security: authenticate the bearer rather than trusting `stdb_identity`, enforce organization/role permissions, and require existing-account authentication before accepting membership.
- [ ] Shared modules shell: remove or development-gate the sample Journal and simulated Notebook; they are mounted for every production module route.
- [ ] Realtime ownership: eliminate the simultaneous full API WebSocket and direct STDB subscription paths, and stop retaining every visited module's subscriptions for the whole browser session.

## Target page-data architecture

### 1. Replace positional props with query-cache hydration

- [ ] Add a pure, server-safe query-key registry in `@lumiere/query-hooks` and make every read hook consume keys from it. It must not import React or contain a `"use client"` directive.
- [ ] Add a server seed helper that accepts named seed specifications rather than positional arrays. Each specification contains a query key and a `QueryResourceKey` or custom server loader.
- [ ] Run seed reads with `Promise.allSettled`.
  - Successful results, including a legitimate empty array, are inserted into a server `QueryClient`.
  - Failed results are omitted from the dehydrated cache so the matching client hook fetches immediately.
  - Failures are logged with route, resource, organization, and status, without tokens or row contents.
- [ ] Wrap each seeded module client in TanStack Query's `HydrationBoundary` using the dehydrated state.
- [ ] Remove `initialX` prop lists after each route migrates. Pages should pass identity and non-query presentation data only.
- [ ] Delete `serverFetchQueryListsAllowEmpty` once no route depends on its ambiguous `[] on error` contract.

This removes the class of bug where a page fetches a row set, adds a prop, and the client forgets to use it. The query key becomes the single contract between the server seed and client hook.

### 2. Standardize read-hook options

- [ ] Replace inconsistent positional signatures such as `(organizationId, initialData)`, `(organizationId, enabled)`, and `(organizationId, options)` with one options shape:

```ts
type QueryHookOptions<T> = {
  enabled?: boolean
  initialData?: T
  staleTime?: number
  refetchInterval?: number | false
}
```

- [ ] Preserve compatibility during migration with temporary overloads, then remove positional overloads after all web and mobile call sites migrate.
- [ ] Ensure all hooks use the common empty-seed policy. With cache hydration, a successful empty response remains valid; a failed server fetch never enters the cache.
- [ ] Export query option builders for queries used by both pages and nested panels so query keys, stale times, and fetch functions cannot drift.

### 3. Classify every page query

- `initial`: required to render the default route/tab or its immediately visible metrics. Fetch on the server and hydrate.
- `deferred`: belongs only to another tab, dialog, or optional panel. Pass `enabled` based on active UI state; optionally prefetch on hover/focus.
- `polling`: live inbox/run-status data. Hydrate the first result when practical, then poll only while the route or relevant tab is visible.
- `event-driven`: only needed after a user action. Do not fetch on page load.

- [ ] Standardize all module pages on URL-backed `useModuleTab` so query enablement is deterministic and deep links load the required data.
- [ ] Extend `ModuleView` only where needed to expose dialog/form-open state; do not add conditional hook calls.
- [ ] Pause polling when `document.visibilityState !== "visible"` or when the polling tab is inactive.
- [ ] Apply the same classification to provider/shell reads and realtime resources, not only hooks called directly by `*-client.tsx`. "No hidden-tab request" includes HTTP/RSC fetches, API WebSocket resources, and SpacetimeDB subscription SQL.
- [ ] Derive the initial set from the default dashboard's actual data dependencies rather than preserving a route's current SSR resource list. Form references and configuration rows are deferred even when they are cheap today.

### 4. Cache session and bootstrap data once per request

- [ ] Wrap `getBrowserStdbSession`/`getStdbSession` in React `cache()` for request-local deduplication.
- [ ] In the root layout, start role assignments, roles, and companies concurrently after session resolution.
- [ ] Hydrate global reference queries (`roles`, `companies`, and other provider-owned reads) once instead of passing reduced data while clients refetch full rows.
- [ ] Make the modules layout and route pages reuse the cached session resolver.
- [ ] Remove redundant `try/catch` blocks around helpers that already swallow errors; the replacement helper must expose success/failure explicitly.

### 5. Bound and sanitize dehydrated data

- [ ] Create a new server `QueryClient` per request. Never share dehydrated cache state between requests or principals.
- [ ] Require every non-global query key to include all data and authorization dimensions: organization, company, user, proposal/entity ID, filters, cursor, and page size where applicable.
- [ ] Define route seed budgets: maximum rows per resource, total serialized bytes, and server query timeout. Fail CI or route tests when a representative payload exceeds the budget.
- [ ] Replace whole-collection seeds for high-cardinality resources with summary or paginated loaders. This applies especially to telemetry, messages, trial balances, moves/move lines, stock moves, documents, proposal source content, and other append-only histories.
- [ ] Dehydrate allowlisted client fields only. Do not serialize credentials, bearer tokens, reset/invite secrets, internal authorization data, or unnecessary personal data into HTML/Flight payloads.
- [ ] Verify every seeded value is serializable and stable across the server/client boundary; explicitly handle dates and large integer identifiers rather than relying on accidental JSON coercion.
- [ ] Propagate request cancellation/timeouts to server loaders so abandoned navigations do not continue expensive seed work.
- [ ] Add a two-organization concurrency test proving that rows cannot cross between request payloads, plus payload-size and sensitive-field snapshot tests.

### 6. Make create mutations return authoritative identities

- [ ] Require create APIs/reducers to return the created ID or canonical row, optionally with a client correlation ID.
- [ ] Update the matching query cache from the mutation response, then invalidate narrowly when server-derived fields require reconciliation.
- [ ] Remove whole-collection refetches followed by "newest row by name/partner/title" heuristics and polling loops. These are race-prone when two users create similar records concurrently.
- [ ] Add concurrency tests for duplicate names and simultaneous creates, and contract tests that every create response exposes its authoritative identity.

### 7. Give realtime data one owner and a lifecycle

- [ ] Choose one browser realtime architecture. Prefer the cookie-authenticated API-server WebSocket already represented by `LumiereRealtimeBridge`; do not also expose the bearer to a direct browser STDB connection.
- [ ] Replace the default full-client resource subscription with route/tab-scoped resource sets. A hidden tab should not subscribe merely because its component or module mounted.
- [ ] Make subscriptions reference-counted and releasable on tab change/unmount. Navigating through modules must not accumulate all previously visited resources in memory.
- [ ] Define realtime-to-query-key mappings in the same registry used for hydration so events update or invalidate the correct tenant/filter cache only.
- [ ] Specify ordering for hydration, mutation responses, and realtime events to prevent an older server seed from overwriting newer live data.
- [ ] Add browser tests for one transport only, subscription counts before/after navigation, teardown on sign-out, hidden-tab silence, reconnect, and hydration/realtime races.

### 8. Add App Router failure and loading boundaries

- [ ] Add meaningful `global-error.tsx`, `loading.tsx`, `error.tsx`, and `not-found.tsx` coverage at the root and route-group level; currently none exist under `app`.
- [ ] Add narrower error boundaries around heavy or independently recoverable panels such as AI harnesses, reports, maps/3D, and proposal collaboration.
- [ ] Audit every `useSearchParams` consumer. Move parsing to server pages where possible; otherwise provide a meaningful `Suspense` boundary. CRM and Sales URL-backed module state need the same treatment already attempted by Purchasing and Manufacturing.
- [ ] Add navigation tests for slow seeds, rejected seeds, missing records, client render errors, retry behavior, and preserved URL state.

### 9. Keep production sample data unreachable

- [ ] Inventory every `sample*`, `demo*`, fixture, mock response, and static KPI import, then prove whether it is reachable from a production route or shared shell.
- [ ] Remove or development-gate production-reachable Journal `sampleWorkNotes`, Notebook fabricated financial execution, map/forensics/POS fallbacks, tracker KPIs, and settings custom fields.
- [ ] Audit shared navigation and the command palette so unavailable showcase routes cannot be entered indirectly.
- [ ] Add a production-build test that rejects imports from designated fixture/demo modules into route-reachable chunks and an E2E assertion that known sample IDs/values never render.

## Cross-cutting code-quality guardrails

- [ ] Install and configure ESLint for Next.js, React, hooks, and TypeScript. The rule set must report unused destructured parameters and must not exempt `_initial...` aliases.
- [ ] Add `noUnusedLocals` and `noUnusedParameters` to the normal TypeScript configuration as a secondary guard.
- [ ] Remove `typescript.ignoreBuildErrors` from `next.config.mjs`.
- [ ] Make CI run `lint`, `typecheck`, unit tests, page-data contract tests, and `next build`.
- [ ] Replace hard-coded unit-test file lists and narrow filename globs with discovery that includes every new unit/contract test. Add root workspace tasks for lint/test/build and verify CI invokes the same commands developers run locally.
- [ ] Run critical E2E for changes under `app`, providers, query-hooks, UI, authentication, and relevant configuration; listing Playwright tests is not execution.
- [ ] Add a seed-key parity test: every server seed key must equal the key produced by its client query option builder.
- [ ] Extend parity coverage to mutation and realtime invalidation aliases. Derived queries must declare their source resources so `mail-messages` updates invalidate AI-draft notifications and approval mutations invalidate the actual organization-scoped inbox key.
- [ ] Add a page classification test: every direct page read is registered as `initial`, `deferred`, `polling`, or `event-driven`.
- [ ] Add a regression test where an SSR query fails: the client query must execute rather than displaying a fresh empty cache for 30 seconds.
- [ ] Add a regression test for a successful empty SSR query: the client must not immediately duplicate the request.
- [ ] Add `optimizePackageImports` for `@lumiere/ui` and `lucide-react` if bundle verification confirms compatibility.
- [ ] Move hot client components from the `@lumiere/ui` root barrel to stable subpath imports. Keep type-only imports explicitly marked.
- [ ] Record route-level JS sizes before and after the import migration; reject regressions for the six largest modules.
- [ ] Split feature clients so the route-level `*-client.tsx` is primarily orchestration and stays below roughly 500 lines. Large tab implementations may remain larger when cohesive, but must be dynamically imported if absent from the initial tab.
- [ ] Inventory oversized nested panels too, including Reports owner/query-builder panels, Sales operations, Inventory cycle count, ModulesShell, and Accounting payment operations. Split by data/state ownership and lazy-load boundaries, not line count alone.
- [ ] Configure a workspace-aware dead-code/dependency check with explicit Next.js, Playwright, and generated entry points. Cover unused files, exports, and packages in addition to TypeScript imports; remove stale examples such as unreachable entry-table samples and unused subscription hooks after reachability is verified.
- [ ] Apply the unused-variable policy consistently across web, UI, and query-hooks; remove underscore-prefix exemptions that hide intentionally discarded initial-data props.
- [ ] Define supported `@lumiere/ui` feature entry points in the package export map before migrating imports. Align TypeScript and Next.js resolution to that public contract and test each entry point rather than relying on web-only source aliases.
- [ ] Dedupe workspace client dependencies and verify one runtime copy of context-sensitive libraries; bundle reports must show duplicate modules/versions as well as route totals.
- [ ] Adopt one formatter/quote/semicolon policy and apply it after functional changes to avoid obscuring behavior changes.

## Accessibility and interaction-state guardrails

- [ ] Require explicit loading, error, empty, and ready states for page-level queries; do not turn query failures into empty business datasets.
- [ ] Add semantic form names/labels/autocomplete, `role="alert"` or `aria-live` async feedback, focus-first-error behavior, and disabled/pending semantics to authentication and mutation forms.
- [ ] Add a skip link and stable `<main>` target to the modules shell; give icon-only controls accessible names and preserve keyboard/focus behavior across dialogs, tabs, and lazy panels.
- [ ] Respect reduced-motion preferences and keep focus stable across loading, error, and optimistic states.
- [ ] Add automated accessibility checks for landing, each auth state, shell/default module, modal, loading, empty, and error states, backed by focused keyboard/focus E2E tests.

## Authentication and tenant-isolation hardening

These items are correctness prerequisites, not optional cleanup. The page audit crosses the Next.js route, API-server session, and SpacetimeDB authorization boundaries because a clean client contract cannot compensate for an unauthenticated backend operation.

- [ ] Remove `stdbToken` from root-layout/client-provider props and the direct browser STDB connection. Delete legacy STDB tokens from browser storage on migration/sign-out and rotate credentials that may already have been exposed.
- [ ] Add a regression test proving bearer values never occur in rendered HTML, Flight data, client props, logs, analytics, or `localStorage`/`sessionStorage`.
- [ ] Move `saveStdbSession`/`clearStdbSession` out of a `'use server'` action module into a `server-only` internal library. No client-callable action may accept a bearer token as an argument.
- [ ] Redact telemetry globally: pageviews use pathname plus an allowlist of harmless parameters, not raw `searchParams`; auth tokens, callbacks, and error text never enter analytics events.
- [ ] Consume reset/invite secrets server-side and immediately transition to token-free URLs. Use an opaque, short-lived, single-use WorkOS state handle rather than putting the plaintext invite token in OAuth state.
- [ ] Make WorkOS invite completion idempotent/atomic and route failures to a visible token-free retry/error state; do not log an error and continue as if membership succeeded.
- [ ] Validate every WorkOS `returnTo`, local-auth `redirectTo`, and sign-out destination with one server-safe same-origin relative-path parser or an explicit external WorkOS allowlist. Cover direct/tampered server-action submissions, protocol-relative paths, encoded variants, backslashes, and control characters.
- [ ] Make sign-out always terminate STDB and WorkOS sessions, clear query/realtime state and legacy browser storage, and use the same behavior in forwarded and fallback configurations.
- [ ] In `/auth/invite`, resolve a verified API session instead of trusting an identity cookie; derive caller identity/organization from that session, verify organization membership and target-role ownership, and authorize by permission rather than role name.
- [ ] For local invite acceptance, require an existing account to prove its existing password or complete an authenticated SSO/sign-in flow before creating membership. Never issue its stored session merely because the email matches.
- [ ] Add per-IP and normalized-account rate limits for sign-in, sign-up, forgot/reset password, invite, and invite acceptance while preserving account-enumeration-safe responses.
- [ ] Treat `proxy.ts` authentication as a routing optimization at most; cookie presence is not authentication. Keep layouts and API handlers authoritative, remove dead presence-only auth branches, and prevent clients from spoofing any private pathname header.
- [ ] Replace raw API-forwarding exception details with a stable public error and correlation ID; log redacted target/error details server-side.
- [ ] Add negative auth tests for forged identity cookies, missing/invalid bearer tokens, cross-tenant organization/role IDs, non-admin invite callers, reused/expired secrets, unsafe redirects, and both sign-out configurations.

## Shared layouts, providers, and root page

### Root layout and providers

Current concerns: repeated uncached session reads, sequential role reads, reduced server data followed by client refetches, unused font return values, and a single global provider component that owns unrelated concerns.

- [ ] Apply the cached session/bootstrap design above.
- [ ] Parallelize `user-roles`, `roles`, and `companies` reads and hydrate their actual query keys.
- [ ] Use the `Geist`/`Geist_Mono` return values on `<body>`/CSS variables or remove the font calls entirely.
- [ ] Split `Providers` into query/realtime, identity/RBAC, and presentation/analytics boundaries while preserving provider order.
- [ ] Keep the root provider boundary minimal for landing/auth routes (for example theme/i18n only). Move ERP query, realtime, RBAC, and module analytics beneath the `(modules)` layout so public/auth pages do not boot the application stack.
- [ ] Move PostHog and Vercel analytics initialization behind explicit production/configuration checks and confirm that they do not block hydration.
- [ ] Do not serialize `session.stdbToken` into the client provider tree. Keep authentication at the HTTP-only cookie/API-server boundary.
- [ ] Remove the duplicate direct STDB browser provider after selecting the authoritative realtime transport; ensure query and realtime state are both cleared when identity or organization changes.
- [ ] Add tests for authenticated, anonymous, missing-organization, role-query-failure, and company-query-failure rendering.

### Modules shell and shared navigation

- [ ] Stop mounting Journal and Notebook implementation code on every module route. Load an authorized panel only when explicitly opened.
- [ ] Apply the same lazy/conditional boundary to AI chat and the command palette; hooks for company/messages/mutations must live inside the opened panel rather than initialize from `ModulesShell`.
- [ ] Replace Journal `sampleWorkNotes` and Notebook's fabricated financial/Python results with live, typed services or a clear unavailable state; otherwise move both tools to `/dev` and remove their production navigation/command entries.
- [ ] Audit sidebar and command-palette entries for Journal, Notebook, Forensics, Trackers, and any other showcase-only destinations so navigation reflects production availability and permissions.
- [ ] Scope realtime subscriptions to the current route and active panel instead of treating module mount as permission to subscribe to the entire workspace.
- [ ] Add shell tests for initial bundle composition, panel lazy-loading, RBAC visibility, sample-data absence, subscription release, and sign-out cleanup.

### `/` landing page

- [ ] Reuse the cached browser session rather than resolving it independently.
- [ ] Import only the landing action and presentation components needed by this route.
- [ ] Keep this page server-rendered; no query hydration is required beyond authenticated state.
- [ ] Test anonymous and authenticated call-to-action destinations.

### Auth layout

- [ ] Extract a stable route-to-back-link function outside render; translate only the selected label.
- [ ] Replace repeated auth card/form framing with small shared components for status, password confirmation, and submit state.
- [ ] Keep the layout client-side only for translation/pathname needs; do not move the actual credential operations into it.

### Onboarding layout

- [ ] Reuse the cached server session.
- [ ] Retain both redirects: anonymous to sign-in and already-onboarded users to overview.
- [ ] Add redirect tests so onboarding cannot be entered for another organization via client state.

### Modules layout

- [ ] Reuse the cached server session and organization bootstrap.
- [ ] Centralize safe callback-path normalization with the sign-in page.
- [ ] Prefer a reliable middleware/proxy-provided pathname header over probing three undocumented headers; document the chosen source.
- [ ] If the proxy supplies the pathname, overwrite a private request header and ignore any client-supplied value; do not revive the current unverified cookie-presence auth branches.
- [ ] Test anonymous deep links, missing organization, and preserved query strings.

## Authentication pages

### `/sign-in`

- [ ] Move callback parsing to the server page wrapper and pass a validated relative path to a focused client form.
- [ ] Apply the same server-safe validator inside every WorkOS server action and to local API `redirectTo` responses; client parsing alone does not protect forged action submissions.
- [ ] Use a shared auth mutation helper for JSON parsing, normalized errors, pending state, and analytics.
- [ ] Keep WorkOS and password modes explicit; do not render inactive mode dependencies when the feature is disabled.
- [ ] Test open-redirect attempts, failed credentials, network failure, WorkOS mode, and successful callback navigation.

### `/sign-up`

- [ ] Reuse the shared auth form and password-confirmation field logic.
- [ ] Keep analytics after a successful response only; never attach passwords or raw server error bodies.
- [ ] Test password mismatch, duplicate account, network failure, WorkOS mode, and onboarding redirect.

### `/forgot-password`

- [ ] Catch network failures and still render a non-enumerating response that does not reveal whether an account exists.
- [ ] Prevent the current unhandled promise rejection when `apiFetch` throws.
- [ ] Reuse the shared email field/status framing.
- [ ] Test success, server error, network error, and WorkOS reset mode with identical privacy-safe messaging.

### `/reset-password`

- [ ] Parse the reset token in a server wrapper and pass it to the client form; render the invalid-link state server-side where possible.
- [ ] Consume the secret server-side and immediately replace the browser URL with a token-free state handle; assert that analytics never receives the token or auth error query values.
- [ ] Reuse shared password-confirmation and auth mutation behavior.
- [ ] Test missing, invalid, expired, already-used, and valid tokens plus WorkOS mode.

### `/accept-invite`

- [ ] Parse the invite token and invite error in a server wrapper; do not make routing correctness depend on client `useSearchParams`.
- [ ] Exchange the plaintext secret for an opaque, short-lived, one-time handle before WorkOS redirect/state or analytics; never echo invalid/expired tokens back into a URL.
- [ ] Require existing local accounts to authenticate with their current password (or complete authenticated SSO) before membership is added; handle new accounts separately.
- [ ] Make membership creation plus invite consumption idempotent/atomic and show callback completion failures instead of silently continuing into the app.
- [ ] Reuse shared password fields and error handling for local-auth mode.
- [ ] Keep WorkOS invite acceptance and local acceptance as separate focused forms.
- [ ] Test missing, invalid, used, expired, and valid invites, including callback/organization assignment.

### `/onboarding`

- [ ] Move the large bootstrap payload construction into a typed builder shared with the route handler.
- [ ] Validate organization code, timezone, currency, and fiscal-year values with the same schema on client and server.
- [ ] Keep analytics non-blocking and free of sensitive bootstrap data.
- [ ] Add idempotency protection so double submission cannot create two tenants.
- [ ] Test validation, duplicate code, partial bootstrap failure, retry, sign-out, and successful redirect.

## Development page

### `/dev/[[...devPath]]`

- [ ] Keep the server-side development/localhost guard.
- [ ] Replace the mounted-state effect with a single dynamically imported client-only router entry if TanStack Router requires browser globals.
- [ ] Ensure dev route modules are excluded from production client bundles.
- [ ] Test localhost development access and production/not-localhost 404 behavior.

## Module pages

### `/overview` — currently 8/12 direct reads seeded

- [ ] Keep sale orders, account moves, stock quants, products, tasks, projects, purchase orders, and contacts in the initial dashboard seed.
- [ ] Add payment transactions, payment reconciliations, and message batches to the initial seed because their metrics are rendered by the overview/control-loop surface.
- [ ] Classify the AI action-draft inbox count as `polling`; hydrate its first value while it participates in `isDataReady`, then poll only while visible.
- [ ] Reuse globally hydrated company/identity data rather than querying it again.
- [ ] Split `OwnerControlLoop` into a dynamically loaded panel if it is not above the fold.
- [ ] Test zero-data, partial-query failure, cross-company aggregation, and dashboard metric parity.

### `/accounting` — currently 5/38 direct reads seeded; 4,660-line client

- [ ] Immediately fix taxes, analytic accounts, and journals hydration.
- [ ] Initial dashboard/core seed: accounts, moves, move lines, taxes, budgets, journals, fiscal years, periods, tax deadlines, companies, sale orders, contacts, account payments, and financial reports actually used by default-dashboard metrics or immediately available quick actions.
- [ ] Deferred by tab: budget lines/posts; analytic lines/distribution; bank statements/lines/matches/reconciliation; assets/depreciation; payments/payment terms; account types/groups; consolidation; intercompany; FX; partner credit; and amortization.
- [ ] Enable deferred reads only for their owning tab/dialog and prefetch reference rows when the user opens a related form.
- [ ] Split the client into dashboard, journal/invoice, budget, analytic, banking/reconciliation, asset/payment, consolidation/intercompany, and FX/credit/amortization controllers.
- [ ] Replace the 300+ symbol UI import surface with feature-local direct imports.
- [ ] Add tests for the three previously ignored seeds, tab-gated requests, period setup, and partial SSR failure.

### `/ai-action-drafts`

- [ ] Hydrate the initial inbox and filtered notification list using trusted organization/company context.
- [ ] Keep 30-second polling only while the page is visible.
- [ ] Remove the copied `draftStates` effect; derive view payloads from query data with `useMemo`, applying optimistic mutation results through the query cache.
- [ ] Declare the filtered notification query as derived from `mail-messages`, and make draft/approval mutations invalidate the real organization-scoped inbox and notification keys.
- [ ] Make draft persistence return its created ID/row; remove the post-create full-draft-list scan.
- [ ] Do not expire drafts via a mount effect. Move expiry to an idempotent backend schedule or an authenticated server operation.
- [ ] Test polling pause/resume, optimistic approve/reject/update, elevated-approver rules, and empty/error states.

### `/ai-harness`

- [ ] Keep companies as the only initial seed.
- [ ] Mount or dynamically import only the active harness tab so hidden panels do not initialize heavy UI or requests.
- [ ] Keep report composition, low-stock analysis, and red-action execution event-driven.
- [ ] Add per-panel error boundaries and tests proving hidden tabs issue no requests.

### `/ai-skills` — currently 0/4 direct reads seeded

- [ ] Initial seed: skill catalog, team members, and team-member skill assignments. Seed the catalog through the exact `/api/ai/skills` query option builder rather than assuming the raw STDB resource has the same key/shape; include organization scope where authorization requires it.
- [ ] Defer agent runs to the runs panel and poll only while that panel is visible; do not SSR a rapidly changing run list unless needed for first paint.
- [ ] Split registry, assignments, run form/result, and run-history panels.
- [ ] Standardize query-hook options and remove ad hoc key shapes for organization-scoped AI reads.
- [ ] Test catalog sync, assignment invalidation, run polling, cancel flow, and partial seed failure.

### `/approvals`

- [ ] Initial seed approval inbox and approval rules.
- [ ] Use trusted selected-company context from the bootstrap; do not wait for an unrelated client query before rendering cached requests.
- [ ] Replace hand-built inputs with the shared form system or a focused typed rule form, but keep approval cards independent.
- [ ] Pause inbox polling when hidden and preserve optimistic mutation/error feedback in the query cache.
- [ ] Correct approval mutation invalidation so it targets `ai-action-drafts-inbox` for the active organization rather than an unused generic alias.
- [ ] Test standard and AI-draft approvals, rejection validation, rule creation, polling, and zero requests after unmount.

### `/calendar` — currently 1/2 direct reads seeded

- [ ] Keep calendar events in the initial seed.
- [ ] Classify CRM activities as deferred unless the default calendar view displays them; enable them only for the activity overlay/create flow otherwise.
- [ ] Standardize event/activity mutation invalidation so both calendars update without duplicate refetches.
- [ ] Test event seed hydration, activity toggle, CRUD invalidation, and empty calendar rendering.

### `/crm` — currently 3/13 direct reads seeded; 2,112-line client

- [ ] Keep leads, opportunities, and contacts initial.
- [ ] Add opportunity stages to the initial seed because they are needed to interpret and edit the main opportunity surface.
- [ ] Defer opportunity lines, tags, segments, activities, pricelists, warehouses, products, UOMs, and forecast snapshots to their tabs/forms; prefetch form references on intent.
- [ ] Split dashboard, leads, opportunities/pipeline, contacts, segmentation, activities, and forecasting into feature controllers.
- [ ] Keep URL-backed tabs and use their value for query `enabled` flags.
- [ ] Make contact/lead/opportunity creation return authoritative IDs/rows; remove full-collection refetch plus "newest row by field" matching before custom-field persistence.
- [ ] Test seed coverage, stage rendering, conversion flows, hidden-tab request suppression, and optimistic updates.

### `/distributor` — currently 0/4 direct reads seeded

- [ ] Convert the page to resolve the trusted session and pass/hydrate organization data explicitly instead of discovering it only through `useErpSession`.
- [ ] Resolve the active company deliberately: either persist a validated selection in a server-readable cookie and seed the matching company-scoped pack key, or classify pack status as client/deferred. Do not claim an initial company seed while selection exists only in `localStorage` after mount.
- [ ] Once the company/pack is known, load bounded summary queries for stock, sales, payments, and moves that drive the first screen rather than whole tables.
- [ ] Avoid mounting the four metric queries until pack/company resolution succeeds.
- [ ] Test enabled/disabled pack states, company switching, metric filters, and zero/partial data.

### `/documents` — currently 6/7 direct reads seeded

- [ ] Keep documents and articles initial because they drive the default dashboard.
- [ ] Defer categories, folders, processing jobs, AI insights, and AI agents to their owning tabs/actions; prefetch form references on intent.
- [ ] Split document library, knowledge base, processing, and insight controllers.
- [ ] Replace repeated `Record<string, unknown>[]` casts with exported row types from query hooks.
- [ ] Test folder/category hydration, processing status invalidation, AI-agent deferred loading, and CSV flows.

### `/expenses` — currently 4/8 direct reads seeded

- [ ] Keep expenses, sheets, pricelists, and employees initial.
- [ ] Add sheets-to-approve and missing-receipt exception queries to the initial seed if their dashboard cards remain above the fold.
- [ ] Defer account journals/accounts and approval timeline until the reimbursement/posting form or timeline opens.
- [ ] Split capture, report workflow, approvals, accounting/posting, and analytics panels.
- [ ] Test offline/outbox behavior, exception metrics, deferred accounting references, and approval transitions.

### `/forensics`

- [ ] Remove `sampleForensicReports` from the production route.
- [ ] Until a real forensic query resource exists, remove the route from production navigation and move the showcase to `/dev`; production direct navigation should render a clear unavailable/empty state, never sample incidents.
- [ ] When a backend resource is introduced, make the page a server wrapper with an initial incident seed and keep filters/detail/create behavior in a focused client.
- [ ] Add a test guaranteeing production never renders sample report IDs or values.

### `/helpdesk` — currently 4/5 direct reads seeded

- [ ] Keep tickets initial because they drive the default dashboard.
- [ ] Defer teams, stages, SLAs, and organization users until their configuration/assignment UI opens, or consume globally hydrated reference directories where established.
- [ ] Split ticket list/detail, configuration, and import UI if the client grows further.
- [ ] Test seeded ticket rendering, assignment lookup timing, stage/SLA invalidation, and import errors.

### `/hr` — currently 6/10 direct reads seeded

- [ ] Keep employees, departments, leaves, contracts, and job positions initial; job positions feed open-position dashboard rows and metrics.
- [ ] Defer payslips, pricelists, leave types, payroll structures, and salary rules to their corresponding tabs/forms.
- [ ] Split workforce, leave, contracts, payroll, and configuration controllers.
- [ ] Test hidden-tab request suppression, payroll/leave state transitions, CSV imports, and partial seed failure.

### `/inventory` — currently 14/32 direct reads seeded; 4,046-line client

- [ ] Remove warehouse 3D zones from the default SSR contract. Move `useWarehouse3D` and its four reads into the dynamically imported 3D controller; a validated `3d-view` deep link should load each required dataset exactly once.
- [ ] Keep core inventory seeds required by dashboard/products/stock/transfers/warehouses/adjustments.
- [ ] Seed the short-ATP, expired-lot, and open-quality-check exception resources used by the default dashboard.
- [ ] Defer valuations, replenishment rules, lots/serial traceability, non-dashboard quality data, picking waves, warehouse tasks, routes/rules, barcode configuration, contacts/documents, and organization users to their tabs/dialogs.
- [ ] Split core stock, warehouse/transfers, adjustments/counting, quality, traceability, replenishment, barcode, 3D, and exception controllers.
- [ ] Dynamically import the 3D viewer and all 3D-only controller code together.
- [ ] Test that the default route does not request 3D zones, a 3D deep link loads each resource once, shared-cache reuse, tab-gated reads, 3D empty state, and inventory mutations.

### `/iot` — currently 7/8 direct reads seeded

- [ ] Keep devices, hubs, pairing tokens, and actions initial because they drive the default dashboard.
- [ ] Defer telemetry, alerts, thresholds, and stock locations to their owning tabs/linking flows.
- [ ] Load telemetry as a bounded recent window with cursor pagination/windowed rendering; never serialize unbounded history.
- [ ] Split device/hub registry, telemetry, actions, and alert/threshold panels.
- [ ] Test initial hydration, location-link fetch timing, telemetry volume, and status mutation invalidation.

### `/manufacturing` — currently 11/12 direct reads seeded

- [ ] Keep productions, workorders, and workcenters initial because they drive the default dashboard.
- [ ] Defer IoT devices, products, warehouses, pickings, quants, quality checks, and other references to their owning tabs/forms; prefetch on intent.
- [ ] Retain the Suspense boundary only if a child actually suspends; otherwise remove the empty boundary or give it a meaningful fallback.
- [ ] Split the row dialog and operational panels from route orchestration where ownership is still mixed.
- [ ] Test seed completeness, quality gating, Suspense/loading behavior, and manufacturing mutation invalidation.

### `/map` — currently 0/3 direct reads seeded

- [ ] Initial seed fleet vehicles, POS terminals, and warehouse geographies.
- [ ] Remove automatic `DEMO_PINS` fallback for authenticated production users. Show per-layer empty states; allow demo pins only behind an explicit development flag.
- [ ] Keep Leaflet/map rendering dynamically imported and client-only.
- [ ] Move form definitions and pin adapters out of the 473-line route client.
- [ ] Test no-data production behavior, dev demo flag, seed hydration, layer toggles, and vehicle position updates.

### `/messages` — currently 2/4 direct reads seeded

- [ ] Keep messages and followers initial.
- [ ] Defer contacts and account moves until compose/link-record interactions need them.
- [ ] Split feed, follower management, compose, and batch panels if future growth continues.
- [ ] Test initial feed hydration, deferred lookups, follower invalidation, and realtime message updates.

### `/pos`

- [ ] Keep products, terminals, configs, and sessions initial through the nested `usePOS` hook.
- [ ] Add loyalty programs to the initial seed because the register is the default tab and promotions affect first interaction.
- [ ] Replace static `posProducts` fallback behavior with a clearly gated demo mode or an empty live register.
- [ ] Defer admin-only mutations/forms from the register bundle with dynamic imports.
- [ ] Test all five initial datasets, empty catalog, register/admin bundle split, session lifecycle, and payment completion.

### `/projects` — currently 5/9 direct reads seeded

- [ ] Keep projects, tasks, and timesheets initial because they drive the default dashboard.
- [ ] Defer pricelists/contacts/employees/users to form interactions and journals/accounts to billing interactions.
- [ ] Split project/task, time tracking, staffing, and billing controllers.
- [ ] Test timer lifecycle, deferred reference data, task hierarchy, billing, and CSV imports.

### `/proposals`

- [ ] Keep proposals initial; this route already has complete direct-read seeding.
- [ ] Convert the single-resource page to the common hydration boundary for consistency.
- [ ] Change proposal creation to return the authoritative proposal ID and navigate directly. Remove the 40-attempt full-list polling loop and non-unique title matching.
- [ ] Split dashboard/list/editor modal logic if needed to reduce the 409-line client below the orchestration target.
- [ ] Test initial list hydration, create/update/status invalidation, and navigation to workspace.

### `/proposals/[id]`

- [ ] Always use `session.organizationId`; remove the `orgId` search parameter.
- [ ] Parse a canonical positive integer ID, then fetch and authorize the proposal server-side. Use the returned title/status instead of trusting `title` from the URL.
- [ ] Return `notFound()` for absent or unauthorized proposals.
- [ ] Add genuinely proposal-filtered and server-authorized loaders for sections, source documents, versions, line items, comments, and presence. Every request and key must carry `proposalId`; do not hydrate all tenant proposal children/source content into one workspace.
- [ ] Seed only the requested proposal's bounded child rows through the shared hydration boundary; paginate potentially large comments, versions, line items, and source content.
- [ ] Refactor `ProposalWorkspaceHooks` so query data comes from standard query options/cache; remove the large adapter layer where signatures can be normalized directly.
- [ ] Pass trusted session user ID/display name into the workspace and enforce comment/presence controls against that identity.
- [ ] Add reducer permission/membership checks to presence and every proposal mutation; a globally guessed proposal ID must never select an organization implicitly.
- [ ] Compute totals only from proposal-filtered line items; the current organization-wide list can contaminate a proposal total.
- [ ] Route AI analysis through an existing authenticated AI route or add a dedicated authenticated handler with organization/proposal authorization. Hide the action until the endpoint exists.
- [ ] Test two proposals with overlapping children, cross-tenant guessed IDs against every workspace mutation, invalid IDs, missing endpoint prevention, bounded hydration, presence cleanup, comment authorization, totals, versions, and AI analysis errors.

### `/purchasing` — currently 9/19 direct reads seeded; 3,019-line client

- [ ] Keep orders, lines, requisitions, contacts, pricelists, products, UOMs, partner banks, and departments initial.
- [ ] Add purchase-orders-to-approve, partial-receipt, and over-billed exception queries to the initial dashboard seed.
- [ ] Defer stock pickings, landed costs/lines, supplier intakes, journals, accounts, and payment terms to their tabs/forms.
- [ ] Split dashboard/orders, requisitions/RFQs, receiving/returns, landed costs, supplier intake/risk, and billing/reference controllers.
- [ ] Keep URL-backed tabs and gate every deferred query.
- [ ] Make order creation return its authoritative ID/row; remove full-order-list refetch plus "newest row by partner" matching before custom-field persistence.
- [ ] Test exception metrics, hidden-tab requests, purchase lifecycle, landed-cost flows, and billing reference prefetch.

### `/reports` — currently seven of eight server resources reach the client

- [ ] Remove `saved-reports` from the default server list and load it only when `PivotExplorer` is active; seed it exactly once for a validated `pivot-explorer` deep link.
- [ ] Derive the default initial set from dashboard dependencies. Defer trial-balance detail, templates, schedules, widgets, saved reports, and specialist datasets unless the active tab needs them; use bounded summaries/first pages rather than whole operational collections.
- [ ] Reuse globally hydrated companies; defer account accounts until a report/template/builder form needs them.
- [ ] Dynamically import pivot, query builder, VAT, and owner-report panels by active tab.
- [ ] Split the 1,521-line client into report lifecycle, templates/schedules, analytics dashboards, and specialist panels.
- [ ] Make report/widget creation return the created ID/row; remove before/after collection scans and "max ID/name" matching.
- [ ] Test that the default route does not request saved reports, a pivot deep link loads them exactly once, empty/failing SSR distinctions, bounded trial-balance payloads, dynamic panels, export, scheduling, and saved pivot CRUD.

### `/sales` — currently 17/30 direct reads seeded; 3,038-line client

- [ ] Keep current orders, lines, price/delivery/loyalty/contact/warehouse/account-move/picking/return seeds.
- [ ] Classify approval and commission summary queries as initial only when rendered on the default dashboard; otherwise gate them by tab.
- [ ] Defer users, products, categories, UOMs, journals, accounts, payment terms, credit controls/holds, and stock moves to the forms/tabs that consume them; prefetch on intent.
- [ ] Split dashboard/orders, quotation/contract, pricing/promotions, fulfillment, invoicing/credit, returns/exchanges, loyalty/POS, and commissions/controllers.
- [ ] Preserve URL-backed tabs and remove direct imperative query fetches that bypass the shared query cache.
- [ ] Make sale-order creation/import resolution return authoritative IDs; remove whole-list refetches and newest-record matching by partner or other non-unique fields.
- [ ] Test seed coverage, form-reference prefetch, approval/commission classification, mutation invalidation, and bundle reduction.

### `/settings`

- [ ] Split the 1,275-line web client into section controllers; do not initialize every mutation hook before a section is selected.
- [ ] Make the selected settings section URL-backed and dynamically import it.
- [ ] Move reads and writes out of `@lumiere/ui` presentation components into web/query-hook controllers with typed props.
- [ ] Replace `sampleUserCustomFields`, default-only profile state, and other sample settings data with live queries or explicit empty/unavailable states.
- [ ] Initial seed only the settings landing/RBAC metadata. Defer users, roles, SSO, audit, forms, organization, integrations, and AI settings until their section opens.
- [ ] Keep sensitive credential values server-only; never hydrate secrets into client props/cache.
- [ ] Before enabling user invitations, make `/auth/invite` resolve a verified bearer session, derive tenant membership server-side, validate that the role belongs to the tenant, and authorize by permission. Add forged-cookie, foreign-role, cross-tenant, and non-admin tests.
- [ ] Test every section's lazy request boundary, RBAC visibility, sample-data absence, mutation errors, and secret handling.

### `/subscriptions` — currently 10/12 direct reads seeded

- [ ] Keep subscriptions initial because they alone drive the default dashboard metrics.
- [ ] Defer plans, schedules/lines, recognition rules, sale orders, pricelists, products, journals, accounts, account moves, and move lines to their tabs/forms/drill-down interactions.
- [ ] Split subscription lifecycle, plans, deferred revenue, recognition, and accounting drill-down controllers.
- [ ] Test deferred accounting queries, activation/closure, invoice generation, revenue recognition, and imports.

### `/tasks`

- [ ] Keep tasks and projects initial; direct-read seeding is complete.
- [ ] Migrate to the common hydration boundary and remove initial props.
- [ ] Align tab/filter URL behavior with the projects module if deep links are supported.
- [ ] Test no duplicate hydration fetch, task state updates, hierarchy, and empty states.

### `/trackers`

- [ ] Stop rendering the static demo dashboard from `dashboard-config.ts` as tenant analytics.
- [ ] Replace it with the stored dashboard/analytics-metrics path already used by Reports, or remove it from production navigation until that integration is complete.
- [ ] Make the page a server wrapper that hydrates dashboards, widgets, and metrics; keep only interactive filters client-side.
- [ ] Test that production values originate from query responses and that no hard-coded currency/KPI values appear.

### `/workflows`

- [ ] Keep workflows, instances, activities, and workitems initial; direct-read seeding is complete.
- [ ] Migrate to the common hydration boundary and remove initial props.
- [ ] Split row-dialog/editing behavior from orchestration if it remains independently testable.
- [ ] Test no duplicate hydration fetch, signal/cancel flows, workitem exceptions, and realtime invalidation.

## Implementation sequence

### Wave 0 — Safety baseline

- [ ] Add ESLint and CI enforcement.
- [ ] Remove ignored TypeScript build errors.
- [ ] Remove the bearer from client props/storage, rotate exposed credentials, select the authoritative realtime transport, and add the no-token-in-RSC/browser regression test.
- [ ] Fix invite authentication/authorization, existing-account acceptance, analytics token leakage, redirect validation, and forwarded sign-out before broader auth refactors.
- [ ] Add request-cached session resolution.
- [ ] Capture route bundle sizes, duplicate modules, RSC bytes/rows, HTTP requests, sockets, and subscribed-resource counts as the performance baseline.

### Wave 1 — Query hydration foundation

- [ ] Add the pure query-key registry, standardized hook options, settled server seed loader, and hydration boundary.
- [ ] Add request-scoped cache, parameterized/paginated seed specs, per-route payload budgets, and sensitive-field allowlists.
- [ ] Add success-empty/failure/key-parity/invalidation-alias/tenant-concurrency tests.
- [ ] Migrate the clean reference routes first: tasks, workflows, proposals list, calendar, helpdesk, manufacturing, IoT, and documents.

### Wave 2 — Correctness defects

- [ ] Migrate and fix accounting, inventory, reports, root bootstrap, distributor, map, and proposal workspace.
- [ ] Remove production demo/sample fallbacks from map, forensics, trackers, settings, and POS.
- [ ] Resolve the proposal analysis route and tenant authorization before re-enabling the action.
- [ ] Replace collection-scan/polling create flows with authoritative mutation IDs in proposals, reports, AI drafts, CRM, Purchasing, and Sales.
- [ ] Add root/route-group loading, error, and not-found boundaries plus query loading/error/empty states.

### Wave 3 — Query deferral

- [ ] Standardize URL-backed tabs.
- [ ] Gate deferred queries across CRM, expenses, HR, projects, purchasing, sales, accounting, inventory, subscriptions, reports, and settings.
- [ ] Add request-count assertions for default-route loads and hidden tabs.
- [ ] Make module/panel subscriptions acquire/release with the same active-state rules and assert socket/subscription counts across navigation.

### Wave 4 — Component and bundle cleanup

- [ ] Split the six largest client files by feature/tab.
- [ ] Dynamically import non-default heavy panels.
- [ ] Move ERP/query/realtime/RBAC providers under `(modules)` and lazy-mount shell AI chat, command palette, Journal, and Notebook; remove or dev-gate their sample/simulated behavior.
- [ ] Migrate root barrel imports and enable optimized package imports after verification.
- [ ] Publish/test stable UI subpath exports, dedupe runtime dependencies, and remove dead files/exports/dependencies with workspace-aware analysis.
- [ ] Apply formatting-only changes separately.

### Wave 5 — Final validation

- [ ] Run lint, typecheck, unit tests, page-data contract tests, production build, and critical E2E suites.
- [ ] Compare HTTP/realtime request counts, subscribed resources, serialized RSC bytes/rows, client JS, and duplicate modules with the Wave 0 baseline.
- [ ] Verify no authenticated production route renders demo/sample business records.
- [ ] Run accessibility checks and keyboard/focus E2E across representative loading, error, empty, modal, and authenticated states.
- [ ] Remove transitional hook overloads, old initial-data props, and obsolete seed helpers.

## Definition of done

- Every one of the 39 pages has an explicit query-loading classification and automated coverage.
- No server fetch result is discarded, accepted under an unused prop, or silently converted from failure to fresh empty data.
- Default page loads issue no client duplicate requests for successfully hydrated queries.
- Hidden tabs and unopened dialogs issue no data requests unless explicitly classified as background/polling behavior.
- Hidden tabs and unopened dialogs acquire no realtime resources; route transitions release subscriptions and maintain one browser realtime transport.
- Proposal tenant scope cannot be influenced by URL parameters.
- Every proposal child loader and mutation is proposal/tenant authorized, and totals never include another proposal's rows.
- Production pages never display demo/sample tenant data.
- No bearer/reset/invite secret appears in HTML, Flight payloads, JavaScript storage, analytics, or public error responses.
- Initial data is request-scoped, tenant-keyed, paginated/aggregated where necessary, and within explicit per-route row/byte budgets.
- Create mutations return authoritative identities; no flow rediscovers a new record by polling/scanning a collection or matching a non-unique field.
- Lint, typecheck, tests, and production build are required and passing in CI.
- The route-level clients for accounting, inventory, sales, purchasing, CRM, reports, settings, HR, and expenses are reduced to orchestration-focused components with feature-local boundaries.
