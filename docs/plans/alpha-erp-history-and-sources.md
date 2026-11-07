# ERP history and source tracing across the current alpha

**Status:** Implementation plan.
**Date:** 2026-11-05.
**Source baseline:** `d8890cec39c805aa5330b1feccab8f6ddff582ea`.

**Implementation:** [Current implementation and remaining acceptance work](../plan/alpha-erp-history-implementation-status.md).

Give users of every current alpha module a consistent way to answer: where did this record come from, who changed it, what changed, and which business records resulted? Deliver record history, module activity, and source-to-record tracing over the existing business owners. Ordinary permitted saves keep applying immediately; history records their committed results.

This expands the history scope of the [Finance change history and review plan](finance-alpha-change-review-plan.md). That plan continues to own proposed changes and their review/application workflow. General rollback, branching, arbitrary point-in-time ERP reconstruction in the UI, and offline synchronization are separate work. Existing domain corrections, reversals, source-review undo and guarded import rollback remain available through their current owners and become traceable events.

## Current alpha coverage

Use the intersection of the [workspace profile](../../frontend/packages/ui/src/lib/workspace-profile.ts), [surface catalog](../../frontend/packages/ui/src/lib/product-surface-catalog.ts), actual module clients, and server admission to establish scope. Visibility alone does not authorize an operation. The profile is still named `finance-alpha`, but includes ten business modules and the supporting surfaces below.

| Module | Required history and source coverage |
| --- | --- |
| Accounting | Invoice, bill and journal headers and lines; posting and correction; payments and allocation; bank statement import, matching and settlement/reversal; assets and depreciation; budgets and analytic records; periods and close; enabled tax, journal, account, currency, payment-term and intercompany setup. Link resulting ledger entries precisely. |
| Sales | Quotations, orders and owned lines; confirmation/cancellation; deliveries, returns and invoice handoffs; available pricing, loyalty, commission, contract, shipping and integration actions. Trace the originating opportunity and resulting warehouse/accounting records where a canonical relationship exists. |
| CRM | Contacts/vendors, leads, opportunities and lines; activities and stage changes; conversion, duplicate merge, tags, segments and enabled pipeline setup. Preserve merge identities and business handoffs. Shared contacts need explicit organization-wide scope. |
| Purchasing | Requisitions, RFQs/bids, blanket orders, purchase orders and lines; approval and confirmation; supplier and bank-reference changes; receipts, returns, landed costs, bills and recovery paths available in the current clients. |
| Reports | Saved definitions, templates, schedules, dashboards, widgets and metrics; generation/export runs and retained artifacts. Record parameters, period, scope, definition version and data cutoff when actually available. A previously generated report remains a historical result when its template or source records change. |
| Subscriptions | Plans, subscriptions, lines, activation, amendments, renewal/cancellation, usage/rating, price tiers, bundles and entitlements; billing runs, payment intents, deferred schedules and recognition actions exposed by alpha. Link exact invoices and entries; preserve effective dates and proration evidence. |
| Expenses | Expense creation/editing, receipt versions, report membership, submission, review, accounting and reimbursement links; available inbox, card-reconciliation and configuration actions. Distinguish approved, posted and paid outcomes. |
| Products | The bounded product catalog: products, categories and supported reference changes, imports, price/cost and unit fields. A master-data change must not rewrite historical transaction prices, quantities or units. |
| Warehouse | All eleven admitted tabs: stock, lots, serials, transfers, stock moves, adjustments, cycle counts, cycle wizard, warehouses, locations and replenishment. Capture counts separately from applied adjustments, reservations and actual movements; retain product, lot/serial, location and recorded unit references. |
| Fleet | Vehicles, driver assignment, service/maintenance, inspections and manual odometer readings within the bounded Fleet workspace. Link recorded service costs to their exact accounting effects. Future GPS/IoT observations are outside current alpha scope. |
| Documents | Upload/import, versions, attachment/link changes, folders, templates, knowledge content, processing, recycle/restore and authorized retention/purge outcomes. Reference immutable file versions and hashes without duplicating file contents into history events. |
| Calendar | Event creation/editing/cancellation, schedule changes, recurrence exceptions and participants where supported, plus linked activity outcomes. Preserve event time zone and recurring-instance identity. |

The table defines required families, not a claim that every named operation is admitted or already captured. Phase H0 resolves each family to actual operations, including secondary tabs and linked record actions. Families with no admitted operation receive a reasoned `not exposed` disposition; enabled mutations must receive implementation and acceptance coverage.

Supporting surfaces also have explicit requirements:

| Surface | Required behavior |
| --- | --- |
| My work and Approvals | Show assignment, claim, decision, rejection, delegation and completion history from their canonical owners. Link the decision to the exact business effect; a decision alone is not proof that the effect happened. Include admitted activity and project-task handoffs without opening the whole Projects module. |
| Overview | Provide an authorized cross-module activity entry point. Aggregate existing events rather than creating a second history store or exposing hidden counts. |
| Settings | Keep source onboarding/review and import tracing accessible to appropriate roles. Cover permitted company/reference/form/custom-field changes and retain access-policy changes in an administrator history category. Record credential changes as safe summaries without secret values. |
| ERP Assistant | For enabled assistant actions, link the initiating user, service/run, reviewed source or draft, and canonical operation receipt. A suggestion or tool invocation must not appear as a committed ERP edit. |
| Linked communications | Include record conversations, financial sends and provider outcomes reached through admitted workflows. Standalone Messages, Journal and Notebook discovery is currently hidden. Do not expand their navigation through this feature. |

The broad Inventory workspace, POS, Manufacturing, Helpdesk, HR/payroll, Projects, Proposals, Distributor and IoT are not newly admitted. Records and effects already reached through alpha workflows remain in scope under their existing permissions. For example, an employee reference used by Expenses is not a reason to omit its supported import trace or expose payroll history.

## Existing implementation to reuse

| Owner | Existing foundation | Work remaining |
| --- | --- | --- |
| [Private business changes](../../spacetimedb/src/core/business_changes.rs) and [history API](../../api-server/src/routes/history.rs) | Trusted field evidence, audit identity, actor/time, authorized Accounting reads. Current Accounting coverage includes explicit draft-line additions and ordinary draft-line edits. | Expand producers and record families, including create/delete, headers, lifecycle effects, imports and service operations. Generalize authorization beyond company-owned Accounting records. |
| [Organization persistence](../../spacetimedb/src/core/persistence.rs) | Transactional operation commits, exact row outcomes, checksums and durable projection/reconstruction. | Register new evidence and relationships with the existing generated contracts and durability checks. Commit capture alone does not establish a readable historical diff. |
| [Source review](../../api-server/src/routes/import_reviews/mod.rs) | Immutable source context, revisioned decisions, prior values, confirmed fields, actor/reason and paginated history in PostgreSQL. | Add scoped staff read authority and verified links to import outcomes. Preserve the separate review-write boundary. |
| [Import tracking](../../spacetimedb/src/data_ops/import_tracker.rs) and [source admission](../../api-server/src/import_admissions.rs) | Job outcomes, import-row-to-record mapping and immutable admission receipts. | Connect original source location and review revision to the exact import row and resulting record; classify older incomplete mappings honestly. |
| [Record changes](../../frontend/packages/ui/src/entity-views/record-change-history.tsx) and [available source history](../../frontend/web/components/available-history.tsx) | Expandable comparisons, review/source inspection and coverage states. | Share these views across records, record sheets, module feeds and onboarding. |
| [Legacy audit tab](../../frontend/packages/ui/src/entity-views/record-audit-tab.tsx) | Existing placement on many record pages. | Replace client filtering of the latest 500 organization events with scoped server pagination. Retain legacy events as explicitly limited evidence. |

## User experience

Every supported record page and record sheet gets **History & sources**. It has a timeline of successful business changes and a source view showing the exact origin, review and import links. Records without standalone pages use the same component in their existing detail sheet. List rows provide an **Open history** action with a stable deep link.

Each event shows a plain-language action, actor, recorded time, supplied reason and authorized affected fields. Expanding it shows exact before/after values and related records. Display historical currency and units only when captured; do not enrich historical values with today's labels or rates as if they were original. Unknown, null, empty and zero remain distinct. Bulk operations have one operation summary with paginated child results, not thousands of unrelated cards.

Each module gets an **Activity** view with server-side filters for record, operation, actor, source/import batch and time. The Overview activity entry uses the same API, restricted to authorized alpha modules. Shared events appear once in aggregate results, with links to each relevant record. Failed attempts and uncommitted requests, where useful, stay visibly separate from saved business changes.

For onboarding, users can navigate both ways:

```text
Original file version and location
    → saved interpretation and review revision
    → submitted import row and its result
    → ERP record
    → later changes and linked business effects
```

Some records start with manual entry, a service operation or an integration. Show that known origin rather than requiring a source file. Some imported observations never become native records; show their current state without inventing an ERP destination. Model multiple sources contributing to one record and one source producing multiple records explicitly.

Use **Source fact confirmed**, **ERP record created**, **Posted**, and **Settled** only when their respective owners establish that state. Show the original business date separately from review, import and edit timestamps. Date ranges and imprecise/unknown business dates retain their precision and original wording.

History includes a coverage notice per record family and operation: capture start, included operations, loaded range and missing evidence. A legacy snapshot can be labelled **First observed state** with its actual observation time. Never fabricate previous values, creation dates, or historical actors from the current record. Authorized revision comparison can be added when retained evidence supports it; incomplete periods cannot support a full reconstructed version claim.

## Capture and source contracts

Extend the existing private evidence owner with a versioned envelope and typed relationships. Use canonical operation IDs and generated schemas, not a second handwritten command catalog. Preserve existing event IDs and consumers through additive contracts and compatible readers.

| Contract element | Required information |
| --- | --- |
| Identity and scope | Stable event ID, producer/schema version, organization, explicit company or organization-wide scope, primary aggregate and affected child identities. Never use a made-up company to accommodate shared CRM or configuration records. |
| Actual outcome | Canonical operation and receipt/commit identity; event kind; actor, verified initiator/delegation when available, human/service/import origin; recorded timestamp and domain effective date when known. |
| Comparison | Bounded typed material field and line changes, explicit creation/deletion state, before/after fingerprints and versioned field policy. Keep exact decimal and identifier representations. |
| Relationships | Source document/version/location/hash, source review item and exact revision, import job/row, workflow decision, assistant run and resulting business records, as applicable. Each relationship has its own provenance and current read policy. |
| Completeness | Captured operations/fields, producer coverage start, missing/legacy source status, projection position and retention availability. |

Capture business changes in the same native transaction as the mutation and its organization commit. One operation may affect many records; group by its canonical identity while retaining per-record evidence. Identical retries must not create duplicate effects or history; a no-op must not claim a material change. Cancellations, corrections, reversals, merges and deletions append new evidence.

PostgreSQL source-review decisions remain atomic in their own existing transaction. Source review and a later native import are separate operations across stores: do not claim distributed atomicity. Bind an import to a validated immutable review revision/admission and exact submission hash; persist the binding with the canonical import outcome. If the response is lost, reconcile by stable request/receipt identity before retrying. A newer source review does not rewrite an earlier import's origin.

Treat CSV metadata, filenames and caller-authored audit rows as claims until verified. New imports need a server-validated mapping from original source location through any transformed row to the submitted row and result. A matching name, amount or date is insufficient. Missing original bytes remain explicitly unavailable even if a hash or quoted source survives. Older mappings can be linked only with exact retained evidence; otherwise retain them as unresolved or attributed legacy context.

Keep source rows immutable when interpretations change. Changed files create new versions and review revisions; duplicate content retries preserve existing identities and decisions. Retain split/merge, excluded, failed and partially imported outcomes without counting them as successful native creation.

## Reads and permissions

Generalize the existing history owner into record history, module activity and source-trace reads. Use typed resource adapters with explicit allowed fields, relationship resolvers, deleted-record rules and canonical destinations. Every module uses these shared contracts; a generic resource string must not become arbitrary table access.

Require `business_history:read` plus current record/resource, company and field authority. Introduce a separately scoped source-history read capability or equivalent reviewed policy so ordinary staff can inspect permitted provenance without receiving full organization administration or source-review write access. Extend the existing role editor and role tests; grant only selected pilot roles after the access matrix passes.

Authorize the event, each field and every linked target independently. Titles, counts, filenames, actor labels and search results must not disclose hidden data. Restricted sources may produce a policy-approved unavailable indicator, without leaking their identity. Shared contacts and administrator events need explicit scope rules. Deleted records require an owner-approved tombstone policy with retained scope metadata; if authority cannot be established, fail closed. Retention and file purge must respect existing holds and privacy rules, with unavailable content distinguished from an empty history.

Use stable cursor pagination bound to actor, organization/company, resource, filters and snapshot. Apply filtering and access policy on the server. Sparse authorized pages can be empty with continuation; unavailable or denied reads must not become “no changes.” Recheck current access after protected reads, return private/no-cache responses, and clear client state on company switch, logout or revocation.

Native history uses the organization's existing durable PostgreSQL projection plus an authorized bounded hot tail where needed. Source reviews retain their existing PostgreSQL owner. A federated cursor carries a snapshot/position per provider; define deterministic merge order and deduplication without pretending that independent stores share one transaction sequence. Do not order edits by business-effective dates or infer causality from timestamps; causal links come from exact receipts. Add indexed, tenant-scoped reader paths and database role isolation before broad feeds replace the bounded Accounting reader.

## Durability and operational limits

Register every new evidence relation, link and required snapshot with generated storage ownership, projection and reconstruction. Publish and repin contracts through the normal release workflow; released migrations remain immutable. Upgrade tests must preserve existing history and identifiers.

`business_change` currently remains always hot. Do not delete hot evidence merely because a history screen can read PostgreSQL. Cooling requires a dedicated exact-payload/checksum, contiguous-watermark, dependency and reconstruction proof. Preserve committed evidence through projector failure; show lag/incompleteness rather than silently returning a truncated timeline. A reader outage must never trigger a business operation replay.

Before broad capture, measure expected events and bytes per operation, including line-heavy imports and stock runs. Set evidence size, pagination, indexed-query latency, backlog, storage and recovery thresholds using the pilot workload; record numeric budgets in H1/H2. Define what happens before safe storage capacity is exhausted. Required history must never be silently dropped while a write reports success. Monitor producer failures, projection lag, incomplete links, duplicate suppression and history read latency without logging protected payloads.

## Delivery packages

Each package ends with a reviewable change and its relevant checks. Module packages reuse the shared capture/read/UI contracts and add domain adapters. They do not implement independent timelines or expand product admission.

| Package | Deliverable and owner | Depends on | Completion evidence |
| --- | --- | --- | --- |
| H0 Scope and coverage register | Extend the existing [Finance inventory generator](../../scripts/generate-finance-change-review-inventory.py) for all alpha modules, support surfaces and linked workflows. Product/domain owners resolve actual UI, API, bulk, import, assistant, scheduled, background and operator paths. | Baseline | Every enabled mutation maps to an owner, aggregate, material fields, scope, source policy, capture status and proof case. Unclassified paths fail the inventory check. |
| H1 Shared capture and source links | Persistence/contracts owners implement additive event and relationship contracts, trusted provenance binding, organization-wide scope and durable registrations. | H0 | Native atomic capture/no-op/retry tests; review/import lost-response reconciliation; generated contract release; populated migration and reconstruction proofs. |
| H2 Authorized history reads | API/storage owners implement resource adapters, indexed durable reads/hot-tail behavior, source readers and stable scoped pagination. | H1 | Field/company/role/deletion tests, provider-lag behavior, complete older-history traversal and agreed volume budgets. |
| H3 Shared history views | UI owner delivers record/sheet History & sources, module Activity, onboarding links and Overview entry. Reuse existing comparisons and source inspector. | H2 | A real Accounting plus import-review journey proves both-direction links, permission states, reload/deep links, keyboard/mobile and localization. |
| H4 Accounting and Expenses | COV-08/COV-11 owners complete all exposed headers, lines, lifecycle effects, setup, imports and receipts. | H1–H3 | Source review → draft → edit → post/correct → linked payment/reimbursement has exact history; approvals and posting rules remain authoritative. |
| H5 CRM Sales and Purchasing | COV-03/COV-04/COV-05 owners cover shared contacts, merges, commercial documents, sourcing, supplier changes and warehouse/accounting handoffs. Split by domain into reviewable changes. | H1–H3 | Exact conversion, confirmation, receipt, invoice and return relationships; shared-contact permissions; source import and bulk-edit coverage. |
| H6 Products Warehouse and Fleet | COV-06/COV-15 owners cover every admitted catalog/warehouse tab and the bounded Fleet lifecycle. | H1–H3 | Product import and later edit; stock receipt/count/adjustment/transfer; vehicle odometer/assignment/service histories with exact units and accounting links. |
| H7 Subscriptions and Reports | COV-12/COV-20 owners expose existing amendment/run evidence through shared adapters and fill capture gaps. | H1–H3 | Renewal/amendment/usage → billing → invoice lineage; report definition/version/data-cutoff → artifact trace, with no effect replay during inspection. |
| H8 Documents Calendar and supporting work | COV-18/COV-19 and workflow/core/AI owners cover file versions, events, assignments/decisions, Settings changes and assistant/communication outcomes. | H1–H3 | Version replacement, event change, assignment/decision and assistant/import journeys retain exact links and current permissions. |
| H9 Existing data reconciliation | Import/domain owners classify retained sources, revisions, receipts, record mappings and legacy audit for the current pilot datasets. Add only demonstrable links or explicitly labelled observations. | H1–H2; validate against module adapters | Reconciliation distinguishes verified, incomplete, conflicting and unavailable origins; repeat runs do not duplicate history or change business records. |
| H10 Complete alpha acceptance | Release/domain owners close coverage gaps, run integrated journeys, verify the served revision and enable scoped pilot reads. | H4–H9 | Every in-scope operation has a passing required proof, all alpha surfaces expose working history, and the release checklist below passes. |

Delivery order: establish H0, then shared contracts/reads and one real H3 journey; complete domain cohorts and supporting surfaces using those contracts; reconcile existing data and close H10. Prioritize capture for newly onboarded data early, because missing before-values cannot be recovered later. Shipping the first cohort does not mark alpha-wide history complete.

The current seven-module inventory's operation count is not the denominator for this larger scope. H0 must establish the current count before scheduling the remaining domain work. Estimate each package from its producer and permission gaps after that inventory; a credible end date requires those counts and actual engineering capacity.

## Acceptance and release

Maintain a machine-readable register with module/surface, canonical operation ID, entry path, affected resource, capture policy, source-link policy, authorization owner, coverage start, implementation revision, automated proof and deployed verification. Reuse canonical operation identities and ownership metadata. Coverage is measured by enabled operations and their meaningful fields/paths, not by tabs rendered or audit calls counted. Every enabled mutation must either capture its material result or have a reviewed non-material disposition; missing capture is an open gate.

The shared acceptance suite must establish:

- A permitted creation, edit, deletion/correction and applicable lifecycle operation produces exactly the expected history with the business effect; failed transactions produce no committed-change event.
- Imports, bulk commands, integrations, assistant actions and scheduled/background owners preserve their own operation identities and per-record results. Duplicate retries and lost replies neither duplicate business effects nor invent history.
- Original source → review revision → import result → ERP record is traversable in both directions for verified mappings, including split/merge and partially failed batches. Older unknown provenance stays unknown.
- More than 500 organization events and multiple pages do not hide earlier changes to a selected record. Stable pagination handles concurrent appends, sparse authorized pages and provider lag without duplicates or omissions within its stated snapshot.
- A reader, editor, source reviewer, history reader, administrator and service actor see only the appropriate fields and links. Revocation, cross-company navigation, organization-wide records, deletion and sensitive metadata remain enforced.
- Projection restart, store outage, retry and restore preserve exact event IDs, payloads, source links and financial effects. No reconstruction or screen read redispatches an operation.
- Historical business dates, current edit timestamps, currencies, units, large IDs, unknown values and actor attribution remain truthful after reload and export where supported.
- Every module's list/detail entry points, empty/denied/error/incomplete states, keyboard controls, narrow-screen layout and translated labels work against the actual shared component.

Run existing native/API/storage, frontend and real-service browser harnesses at the matching release revision. Fixtures can prove component behavior but cannot certify persisted domain outcomes. Each domain cohort needs a real creation/import and later-change journey; existing records need a read-only provenance walkthrough. Select a read-only module history smoke check for every covered alpha surface.

For the current onboarding pilot, separately verify the Alpha and Mugisha organization/company scopes. Reconcile source facts, native drafts and posted entries without moving data between tenants. Use existing historical rows for read-only acceptance and disposable fixtures for destructive or financial lifecycle checks. Enabling history does not post drafts or confirm pending source facts.

Release capture and readers compatibly, then enable views and scoped roles by completed cohort. Verify the actual served revision, migrations, projections, permissions and coverage start. Roll back reader/UI exposure independently while preserving captured evidence. Broader capture and hot retention must retain the capacity controls from H1/H2.

Alpha-wide completion means all ten business modules, Documents, Calendar and the supporting surfaces above pass their register and live-read gates. Partial coverage remains visible during rollout and is not accepted as the final state for an enabled operation. Changes to alpha admission must update this register so newly exposed work cannot silently bypass history.
