# COV-06n / COV-07f / COV-07g browser coverage — REVIEW

## Task / base SHA

Missing operator browser coverage from
`cov05-10-cov13-25-runtime-acceptance-2026-10-03.md`.
Application base: `77e3e495af2265be07d36854f7c9740dab435056`.
Contracts: `v0.3.81`, resolved Cargo checkout `6fc1086`
(release revision `6fc1086a036797067ecb29dd113e13c0a82a9bca`).

**REVIEW, not accepted:** all three browser specs are implemented and discovered,
but none has run against a compatible runtime. No U5 promotion.

### Subsequent coordinator runtime findings and bounded source repair

The coordinator subsequently ran the new lane and repaired fixture/SSR setup.
The operator run exposed three actual wiring defects. These follow-up repairs
are source-only; no builds, caches, runtime services or contracts were changed:

- COV-06n scheduler actions had been injected into the **products** tab, not
  replenishment. Moved the two actions into the existing
  `withTransferActions` replenishment branch and included both mutation hooks
  in its memo dependencies. Existing effect resolution remains authoritative.
- COV-07f filtered the default stock-location projection on an omitted
  `scrapLocation` field, leaving no selectable candidates. Replaced the
  misleading filtered selector with explicit positive location-ID input and
  removed its dead query/options plumbing. The existing canonical scrap
  reducer validates the exact location's organization, company compatibility,
  active state and scrap designation; the client does not infer designation
  from names or broaden the read projection. Updated only the new scrap spec
  to enter the exact fixture ID.
- COV-07g omitted absent metadata from its struct wire input, producing
  `invalidargs` instead of an operator effect. The application hook now
  finalizes `metadata` with existing `encodeOptionalString` before
  `stdbParamsToJson`, supplying explicit SATS None/Some without generated edits.

`git diff --check` passed for the follow-up. Prior typecheck/build results below
precede these source repairs; live rerun and any additional verification belong
to the coordinator. Navigation debt remains, and no successful browser run is
claimed here. The initial no-runtime statement above records the first handoff,
not the subsequently available coordinator runtime.

## Files changed

- `frontend/web/app/(modules)/inventory/inventory-client.tsx`
- `frontend/web/app/(modules)/manufacturing/manufacturing-client.tsx`
- `frontend/web/app/(modules)/manufacturing/manufacturing-row-dialog.tsx`
- `frontend/packages/ui/src/lib/manufacturing-row-action-forms.ts`
- `frontend/packages/query-hooks/src/hooks/manufacturing.ts`
- `frontend/web/tests/e2e/cov06n-replenishment-scheduler.spec.ts`
- `frontend/web/tests/e2e/cov07f-finished-output-scrap.spec.ts`
- `frontend/web/tests/e2e/cov07g-bom-byproducts.spec.ts`
- `frontend/web/tests/e2e/cov-scheduler-manufacturing-fixtures.ts`
- This evidence note.

## Before path

Accepted pinned operation and resource manifests contain all required operations
and resources; older backend-only descriptions in the next-assignment plan are
stale. The current individual status plans already describe frontend support.

| Slice | Component/action | Hook | Generated operation | Domain owner |
| --- | --- | --- | --- | --- |
| COV-06n | `inventory-client.tsx`: selected-rule schedule/cancel toolbar actions | `stock-operations.ts`: `useScheduleReplenishmentRun`, `useCancelReplenishmentRun` | `erp.schedule_replenishment_run`, `erp.cancel_replenishment_run` | `inventory/replenishment.rs` |
| COV-07f | `ManufacturingRowDialog` → `submitManufacturingRowAction`: `scrap_output` for Done MO | `manufacturing.ts`: `useScrapFinishedManufacturingOutput` | `erp.scrap_finished_manufacturing_output` | `manufacturing/manufacturing_orders.rs` |
| COV-07g | `ManufacturingRowDialog` → `submitManufacturingRowAction`: `add_byproduct`; MO finish | `manufacturing.ts`: `useCreateBomByproduct`, `useFinishManufacturingOrder` | `erp.create_bom_byproduct`, `erp.finish_manufacturing_order` | `manufacturing/bill_of_materials.rs`, `manufacturing/manufacturing_orders.rs` |

Named operations use `stdbBffCommandPost`/`stdbBffCallUrl`, generated
`OperationInputMap` and `SESSION_OPERATION_DESCRIPTORS`.
The server route is `api-server/src/routes/operations.rs::post_operation`,
using trusted session context and current company authorization before dispatch.
Query resources are registered in the pinned `manifests/resource-registry.json`
and the application registry in `crates/stdb-auth/assets/resource_registry.json`.
No local generated contract changes or alternate mutation authority were added.

## After path

New dedicated Playwright specs drive the existing warehouse-persona UI actions
and independently read canonical persisted resources. Fixture setup and
duplicate/denied probes use named operations only.

The fixture helper snapshots the resource primary-key set before an isolated
setup create, then requires exactly one new primary key. Concurrent unrelated
creates fail closed; run this lane with one worker. This is setup-only and is
never used to discover the operator transition's effect. There is no newest-row,
name/time correlation, sleep, compatibility call, or static form fallback.
Displayed labels select known fixture records, not resulting-effect identities.

## Canonical owners reused

- Existing Inventory and Manufacturing components, row forms, hooks and reducers.
- Existing named-operation transport and pinned contracts.
- Existing canonical query resources and `ModuleView` URL ID filters.
- Existing semantic effect infrastructure, unchanged by this task.

## Effect identity + cardinality

- **COV-06n:** `(organization_id, company_id, rule_id)` → zero or one
  `replenishment-run-jobs` row; exact `scheduled_id` preserved through duplicate
  schedule and denied cancellation. UI cancellation requires canonical absence.
- **COV-07f:** `(organization_id, company_id, production_id, scrapped=true,
  reference=MO/{mo}/SCRAP/{request})` → exactly one `stock-moves` row. The request
  UUID is captured from the actual generated UI request. Exact source/scrap
  quant deltas and unchanged primary finished-move relation are checked.
- **COV-07g:** `(organization_id, company_id, bom_id, product_id)` → exactly one
  `mrp-bom-byproducts` row, owned by `mrp_bom.byproduct_ids`. UI finish produces
  exactly two owned `move_finished_ids`: primary plus byproduct. The byproduct
  move has exact `MO/{mo}/BYPRODUCT/{definition}` reference, MO/company/org
  ownership, destination, quantity and cost share. The destination quant delta
  is checked. Duplicate finish is rejected without additional output.

## Resulting record ref

- COV-06n: `{resource: "replenishment-run-jobs", id: scheduled_id}`.
- COV-07f: `{resource: "stock-moves", id: exact request-bound move ID}`.
- COV-07g: `{resource: "mrp-bom-byproducts", id: exact definition ID}`, then
  source-owned finished stock-move IDs.

**Navigation debt remains:** current scheduler toolbar discards its resolved
record ref; Manufacturing row submission discards scrap/byproduct refs and
closes the modal after hook resolution. No direct resulting-job/byproduct
record view/link is exposed. These tests do not assert such navigation or claim
that BFF query readback substitutes for it. Exact source navigation uses
`?tab=...&filter=id:...`, an existing UI capability.

## Typed outcomes/errors

Existing schedule, scrap and byproduct hooks use canonical effect resolution
and `requireResolvedOperationEffect` (`converged` / `already-applied`, typed
rejection and unknown outcome errors). Existing cancellation separately checks
canonical absence. Tests require denied probes to return `403`, duplicates to
return `422`, and the persisted effect/quantity set to remain unchanged.
These HTTP assertions supplement UI transitions and do not define UI success.

## Tests run (command + result)

- `cd frontend && pnpm install --frozen-lockfile` — passed; lockfile unchanged.
- `cd frontend/web && pnpm exec tsc --noEmit --incremental false` — completed
  without diagnostics. An earlier 120-second attempt timed out; the longer run
  completed.
- `cd frontend/packages/query-hooks && pnpm exec node --import tsx --test
  src/hooks/partial-slice-effects.test.ts src/hooks/operation-effect.test.ts`
  — 14 passed.
- `cd frontend/web && pnpm exec playwright test
  cov06n-replenishment-scheduler.spec.ts cov07f-finished-output-scrap.spec.ts
  cov07g-bom-byproducts.spec.ts --list` — three dedicated tests discovered.
- `cd frontend/web && pnpm exec next build` — passed. Next's generated
  `next-env.d.ts` route-type import change was reverted.
- Browser execution — **not run**. Coordinator reports API `:48082` readiness
  `503`, migration mismatch and incompatible release `0.3.43`; no web runtime.
  No service resets, database changes or publishing were attempted.
- Following the disk-space cleanup request, removed only this isolated worker's
  generated `.next` and duplicate workspace `node_modules` directories (about
  1.8 GB before removal). No `target`/`spacetimedb/target` existed here. Source
  changes and parent/primary directories were preserved; no more builds or
  installs were started.

## Operator proof

**Implemented, runtime blocked per slice:**

- COV-06n: UI schedule → persisted exact job → denied/duplicate probes → UI
  cancel → canonical absence. Actual timed scheduler fire/reschedule is outside
  this browser proof; existing native domain proof remains required.
- COV-07f: UI scrap → request-bound persisted move and exact quant deltas,
  then duplicate/denied preservation. Done-MO creation is fixture setup.
- COV-07g: UI add-byproduct → persisted definition/owned relation → UI finish
  → exact scaled byproduct move and quant output, then replay preservation.
  Confirm/start/produce are fixture setup, not claimed operator transitions.

## Compatibility/debt retired

Dedicated browser specs now exist for all three previously uncovered slices.
No compatibility path or business authority was retired or added.

## Remaining blocker/deferral

Compatible same-head runtime and persona/form authorization evidence are absent.
Result-record presentation/navigation remains unimplemented and unproven.
Readback resolver unit tests passed, but no new live hook/browser integration
evidence is claimed. Governed runtime form/seed work and shared permission
reducers remain coordinator-owned.

## Contract release required: no

All required operations, tables, resources and correlation fields already exist
in accepted `v0.3.81`. There is no producer/release prerequisite to bypass.
The incompatible existing runtime must be aligned with that accepted release;
it is not evidence that a new operation/table release is needed.

## Next bounded task

1. Review these specs and bring up an approved isolated, same-head runtime with
   `v0.3.81`, compatible migrations, and existing governed persona/form setup.
2. Run `E2E_WORKERS=1 PLAYWRIGHT_BASE_URL=<approved-web-url> pnpm --dir
   frontend/web exec playwright test cov06n-replenishment-scheduler.spec.ts
   cov07f-finished-output-scrap.spec.ts cov07g-bom-byproducts.spec.ts --workers=1`.
3. Add bounded operator result-record presentation/navigation using these exact
   refs and existing query resources; test the actual linked readback. Do not
   invent a generic record route or replace it with a raw API link.
4. Retain REVIEW until runtime actions, persisted effects and navigation are
   proven on the same immutable head.
