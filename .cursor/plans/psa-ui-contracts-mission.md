# [psa-ui-contracts] Mission — repair project/timesheet UI contracts

**Handle:** `[psa-ui-contracts]`  
**Wave:** A  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Make create-project and log/start-timesheet UI payloads match SpacetimeDB param types so pilot demos can create billable projects and log time.

**Exit criteria:** Valid `bill_type` / `pricing_type` from forms; timesheet mappers include all required `LogTimesheetParams` / `StartTimesheetTimerParams` fields; dashboard quick actions fire the correct handlers.

## Why this exists

Investigation: `toCreateProjectParams` hardcodes `billType: 'non_billable'` (invalid vs `BillType`); `toLogTimesheetParams` emits UI-only fields and omits `employeeId`, `currencyId`, `employeeCost`, `encodingUomId`.

## Primary artifacts

| Artifact | Path |
|----------|------|
| Mappers | `frontend/web/lib/projects-create-params.ts` |
| Forms | `frontend/packages/ui/src/lib/projects-form-configs.ts` |
| Client | `frontend/web/app/(modules)/projects/projects-client.tsx` |
| Dashboard config | `frontend/web/lib/module-dashboard-configs.ts` |
| Types | `frontend/packages/stdb/src/generated/types.ts` (`CreateProjectParams`, `LogTimesheetParams`) |
| Backend enums | `spacetimedb/src/types.rs` (`BillType`, `PricingType`, `TimesheetInvoiceType`) |

## Out of scope

- Rate card tables / server rate resolution (Wave B `[psa-rates-productization]`)
- Validate SoD / freeze (Wave A `[psa-time-approval]`)
- Tax on `bill_timesheets` (Wave A `[psa-billing-integrity]`)
- Capacity / calendars / milestones

---

## Phase 1 — Param mappers + forms + quick actions

### 1.1 Fix create project

1. Change default `billType` to a valid value (prefer `customer_task` or form-selected).
2. Add form fields for `billType` and `pricingType` (select options matching server enums).
3. Pass through `allowTimesheets` / analytic if already sensible; do not invent rate cards.

### 1.2 Fix timesheet log / timer

1. Extend `logTimesheet` form: employee select, currency (or from project), cost/rate inputs or placeholders until Wave B, encoding UOM, invoice type.
2. Rewrite `toLogTimesheetParams` to emit snake/camel fields expected by BFF → `LogTimesheetParams`.
3. Same for start-timer path in client + mapper.

### 1.3 Dashboard quick actions

Align IDs between `projectsModuleConfig` quick actions and `projects-client.tsx` handlers (`log_timesheet`, `start_timer`, etc.).

### Verify Phase 1

```bash
rg "billType: 'non_billable'" frontend/web/lib/projects-create-params.ts && echo FAIL || echo OK
rg 'employeeId|encodingUomId|timesheetInvoiceType' frontend/web/lib/projects-create-params.ts
rg 'billType|pricingType|customer_task' frontend/packages/ui/src/lib/projects-form-configs.ts
rg 'log_time|view_timesheets' frontend/web/lib/module-dashboard-configs.ts
cd frontend/web && pnpm exec tsc --noEmit 2>&1 | tail -8
```

### Success criteria

- [x] No `non_billable` bill type in create mapper
- [x] Log/start mappers include required server fields
- [x] Forms expose bill/pricing + timesheet employee/currency/UOM
- [x] Quick-action IDs match client handlers
- [x] `tsc --noEmit` clean for touched packages (pre-existing errors remain in unrelated sales/inventory/expenses files)

## Phase 2 — Smoke wiring (optional if ops track delayed)

Manual or assist Playwright: create project → log timesheet appears in table (full lifecycle owned by `[psa-ops-inbox-tests]`).
