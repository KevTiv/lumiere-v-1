# COV-26 — One module quality pass per PR

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** UX / Accessibility  
**Plan target:** common UI-quality pass  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: all T0 modules

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: n/a

## Effect contract

Loading/empty/error/denied states, keyboard/focus, viewports and reconnect evidence per module.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none

## Reports / Analytics bounded pass (2026-10-03)

**State:** REVIEW — one source-state distinction implemented; module quality pass remains open.

The self-serve query builder now renders an accessible loading status separately
from a successfully loaded source with zero rows. A focused pure-state test keeps
unselected, loading, legitimate-empty and ready states distinct.

This does not certify Reports COV-26. The shared stored-dashboard source hook does
not expose query failures, so denied, dependency/query-error and reconnect states
still collapse into the empty data source seen by the Reports view. The existing
create-and-attach widget path also rediscovers the created row by name and newest
id instead of a stable effect identity; it was not changed or accepted in this
slice. Malformed persisted filters/operators, missing timestamp/measure semantics,
keyboard/focus, responsive viewport and browser reconnect/readback proof remain
open.

## Shared read-state contract rollout (2026-10-13)

**State:** REVIEW — branch `claude/cov26-read-state-rollout`, stacked on PR #171
(`codex/fix-module-query-states`). Not accepted: no browser E2E was run.

PR #171 introduced the per-tab `ModuleDataState` contract (ready / loading / error /
denied / partial, retry, HTTP status preserved on query errors) and adopted it in
Subscriptions only. This rollout applies the same contract to the remaining
`ModuleView` workspaces so a failed or denied read no longer renders as an empty list.

Shared additions (`frontend/packages/ui`):

- `moduleCollection(query)` returns `{ state, rows }`; rows are a stable empty list
  when the read is denied (401/403) or failed without a known server status, so stale
  rows cannot reach tabs, joins, form options or dialogs. A 5xx refresh failure with
  cached rows stays `partial` with the stale-data notice.
- `mergeModuleStates(states)` composes dashboards and joined/custom tabs: any denial
  denies, any failure or stale input fails, and retry re-reads every failed collection.
- `ModuleView` now closes an open tab create form or record sheet when that tab's
  collection becomes denied or failed, so recovery does not reopen stale dialogs.

Modules converted (per-tab `dataState`, gated rows, dialogs closed and submissions
refused while their source collection is denied or failed):

| Module | Tabs with explicit state | Dialog handling |
| --- | --- | --- |
| Fleet | vehicles, driver assignment, service records, inspections | tab create forms (ModuleView) |
| Manufacturing | dashboard (merged), orders, BOMs, BOM lines, work orders, work centers, routing, quality | row, quick-action, CSV |
| Messages | dashboard/notifications (merged), messages, followers | quick-action |
| Calendar | dashboard, calendar, events, activities | quick-action, event selection |
| Proposals | dashboard, proposals | create, edit, convert |
| Helpdesk | dashboard, tickets, teams, stages, SLAs | quick-action, CSV, ticket detail |
| Expenses | dashboard (merged queues), expenses, reports | row, workflow, confirm, timeline, CSV, finance |
| Workflows | dashboard, definitions, versions, instances, operations (merged), dead letters, migrations, results | row, quick-action |
| IoT | dashboard, tokens, hubs, devices, actions, telemetry, alerts, thresholds | register, sync, device row, bulk actions |
| Documents | dashboard, documents, recycle bin, knowledge, categories, folders, templates, processing, insights | quick-action, CSV, row, processing, insights, prompts |
| Projects | dashboard, projects, tasks, timesheets, rate cards, resources, approvals, gantt/resource/utilisation/PSA (merged) | create/edit, lifecycle, CSV |
| HR/Payroll | dashboard, employees, departments, leaves, allocations, attendance, contracts, payslips, positions, recruitment, leave types, payroll structures, salary rules, onboarding, compensation, org chart | quick-action, row, CSV |
| CRM | dashboard, leads, opportunities, lines, contacts, activities, tags/categories/segments | quick-action, workflow, import, prompts |
| Sales | dashboard, ops (merged), orders, lines, pricelists, deliveries, fulfillment, returns, invoices, delivery/shipping/payment/loyalty | quick-action, import, chatter, partial delivery, cancel picking, return, credit note, prompts |
| Purchasing | dashboard, orders, lines, requisitions, vendors, RFQs, bids, returns, landed costs, intakes, partner banks | quick-action, CSV, RFQ/return, bill, landed cost, intake, chatter, prompts |
| Inventory | dashboard and 25 entity/custom tabs | product, warehouse, quant, transfer, serial/lot, quality, quick-action, CSV, prompts |
| Accounting | dashboard and 30 entity/custom tabs | quick-action and CSV by action tab; record sheets, row editors and prompts by active tab |

Not converted in this slice:

- Subscriptions (already done in #171) and Reports (#175).
- Workspaces that do not render `ModuleView` (Settings, Tasks, POS, Approvals,
  Distributor, Map, Overview, AI drafts/harness/skills): each needs a bespoke state
  surface; Overview already uses its own resource-state model.
- Custom tab panels that issue their own queries (e.g. Sales commission plans,
  Purchasing blanket/configuration panels, Expenses inbox) and record pages.
- Lookup-only reads (contacts, products, currencies, journals used for options) keep
  their prior fallback; only primary collections are gated.

Validation: web `tsc --noEmit` adds no errors over the stacked base (the base carries 5
pre-existing errors in `documents.ts`, `workflows.ts` and `module-data-notice.tsx`);
web unit suite 373/373; `module-data-state` node tests 7/7; ModuleView vitest includes a
new dialog-closure test. `module-view-create-gate.test.tsx` "leaves tab order and arrow
navigation to the tab primitive" fails on the base as well and is unchanged here.

Remaining before COV-26 acceptance: keyboard/focus proof per module, responsive
viewport proof, browser reconnect/readback evidence for denied (401/403) and failed
reads, and Playwright coverage of the retry path.



## Prerequisites / decisions

COV-03..25 candidates.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `n/a` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
