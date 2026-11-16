# ERP alpha full-history range audit

## Scope and decision

Audited the web ERP module dashboards, shared date controls, read hooks,
authorized query transport, source-history browser, and bounded dashboard/report
reads. Three independent read-only audits covered financial modules, other
modules, and shared/backend infrastructure. Implementation workers then checked
actual rendering paths before changing them.

The canonical contract remains
`frontend/packages/erp-shared/src/history-period.ts`: `all` has open bounds;
custom dates include the whole final calendar day; timestamp intervals are
start-inclusive/end-exclusive. Chart buckets may coarsen but must not drop older
dates. The URL's `period` parameter is the selected-period authority.

No schema, generated bindings, mutation, authorization, or deployment change is
needed. “All history” means available authorized records, not recovery of deleted,
uncaptured, inaccessible, or unknown business facts.

## Confirmed reachable gaps and remediation

| Surface | Previous behavior | Remediation |
| --- | --- | --- |
| Accounting insights | Only 30/90/180 days; default 90 | Shared all/custom selector and canonical bounds, with no invented all-history comparison or DSO/DPO duration |
| Accounting document activity | Exactly six calendar months | Same selected period as accounting insights; adaptive buckets over available dated postings |
| Inventory transfer chart | Exactly seven days regardless of header selection | Header period drives adaptive scheduled-transfer counts; title distinguishes schedules from completed movements |
| HR headcount trend | Six months; missing hire dates treated as old hires | Selected-period reconstruction from actual hire/termination dates, with unknown intervals excluded and disclosed |
| HR leave usage | All leaves regardless of selected range | Full requested days grouped by request start date within the selected range; not overlap-prorated |
| Subscriptions MRR/churn estimate | Exactly twelve months, no connected range control | URL-backed all/custom selector and adaptive dated-contract coverage, clamped to now |
| Shared period URL state | Optimistic selection could precede a pending server navigation; company switching restored the old URL period | Client-only selection commits the URL synchronously through Next's supported native History integration; reload, Back, query/hash preservation and company-switch regressions |

Relevant implementation paths:

- `frontend/web/app/(modules)/accounting/accountant-insights.tsx`,
  `accountant-insights-model.ts`, `accountant-overview.tsx`, and
  `accountant-overview-model.ts`.
- `frontend/web/app/(modules)/inventory/inventory-history.ts`.
- `frontend/web/app/(modules)/hr/hr-history.ts`.
- `frontend/web/app/(modules)/subscriptions/subscription-dashboard-charts.ts`.
- Corresponding client files wire the shared period into the live dashboard.

Current stock, current headcount, open receivables/payables, aging, approval/work
queues, and current subscription plan mix remain current-state views. Selecting
a historical range does not turn these into historical snapshots.

HR reconstruction is not complete staffing history. Subscription history prices
recorded contract intervals at current contract MRR; it is not a billing ledger.
Visible disclosures explain these limits and unknown-date exclusions.

Accounting date columns are source-calendar dates stored at UTC midnight. Decoded
timestamp objects and date strings therefore use the same calendar-date
interpretation, including dates before 1970. An explicit authorized organization
timezone can be passed to the accounting overview. The current session/query
contract exposes organization/company IDs but no Organization timezone read, so
the live client retains UTC and visibly discloses that fallback; it does not
invent a Company timezone or substitute a browser/user preference. Adding an
authorized organization-settings read is a follow-up, not a prerequisite to
removing the history caps.

## Suspects ruled out by rendering-path verification

Sales, CRM, Purchasing, Expenses, and Reports contain older local 30-day state or
fixed 6/12-month and 90-day chart calculations. These were initially flagged by
the static audits, then ruled out as live gaps:

1. Their custom dashboard renders `CompanyModuleInsights` / `ModuleInsights`.
2. That component retains only incoming quick-actions from legacy sections.
3. It builds its own canonical all/custom-aware historical charts.
4. Saved widgets receive `model.bounds` through the composition host.
5. Existing UI tests assert all-history export provenance and that legacy figures
   do not render.

Those unused calculations are not changed in this PR. Removing them is separate
cleanup, not a prerequisite to correcting visible history ranges.

Browser verification did expose a separate shared URL-commit race affecting these
otherwise range-aware dashboards. That race is corrected in `use-history-period.ts`;
it is distinct from the unreachable legacy chart calculations.

CRM forecast snapshots require a finite selected period. The shared model keeps
`all` open rather than replacing it with the oldest loaded date, and the existing
snapshot action rejects non-finite bounds. No change is needed there.

Overview already defaults to `all` and passes the period to its trend helper.
The helper's standalone 180-day default is not used by that live caller.

## Backend/read completeness and deliberate limits

| Read path | Finding / retained constraint |
| --- | --- |
| Native accounting and generic registered resource queries | No hidden 30/90/180/365-day cutoff found. Current accounting hooks do not request a row limit. Server organization/company filtering remains authoritative. |
| Available source history | Already supports all/custom, dated/undated/invalid modes, cursor pages, snapshot continuity, and separate complete coverage aggregates. |
| Stored dashboard resource acquisition | Retains 40-page/20,000-row safety bounds. `complete: false` becomes a partial source state, and widgets must not present it as an authoritative complete total. |
| Report preview sources | Retain bounded preview reads (1,000 rows per source). These are previews, not unrestricted full-history aggregations. |
| Record/business-change history | Retains cursor paging and explicit partial evidence coverage. Page size is not a date limit; deleted or uncaptured changes cannot be reconstructed by adding an “all” option. |

Do not remove safety limits or relabel partial evidence as complete history.
Large-tenant server-side aggregation/pagination is a separate scalability task;
there was no confirmed hidden date cutoff to remove in those APIs.

## Other module coverage and exclusions

The audit searched AI/action drafts/harness, Approvals, Calendar, Distributor,
Documents, Fleet, Forensics, Helpdesk, IoT, Map, Messages, POS, Products,
Proposals, Settings, Tasks, Trackers, Warehouse, and Workflows. No other reachable
module-local historical date cap was confirmed. The mobile app is an API-probe
starter, not a separate ERP historical dashboard.

Retained domain constraints include fiscal/accounting periods for close reports,
calendar-selected days, due-date queues, subscription billing cadences, inventory
cycle-count schedules, project milestone horizons, and recruitment/performance
planning windows. Top-N/recent record displays are not full-history aggregates.

Manufacturing's configured weekly-output chart has no implemented authoritative
output-series read in the audited client. That is an existing missing chart,
not a date-range cap; no synthetic production history is introduced here.

## Verification

`pnpm --dir frontend/web test:history-ranges` is added to frontend CI. It covers
accounting, inventory, HR, subscriptions, shared module insights, source-history
requests, and incomplete bounded sources. Tests use distinctive old dates,
custom boundaries, scope separation, unknown dates, and no invented prior period.

Final local model evidence: 106 history-range tests and 199 shared-package tests
passed under Node 26. The web unit suite passed 1,189 tests. The accounting-model
command also passed (90 model tests plus 5 invoice-record tests). JSON duplicate
keys, locale interpolation/core coverage, loanword generation and `git diff --check`
passed. The full typecheck still reports the baseline generated
`set_ai_agent_model` mismatch and the unrelated untracked AI-chat attachment export.
The aggregate i18n command is likewise blocked by six keys referenced only by an
unrelated untracked AI-chat component; its independent locale checks pass.

Final execution results and remaining environment limitations are recorded in the
PR description. Unit/fixture evidence must not be described as a live tenant
database test. No production data or deployment is changed by this work.
