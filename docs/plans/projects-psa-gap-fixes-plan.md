# Projects & PSA Gap Fixes — Tracker

Executable tracker for the full backlog (Pilot → Competitive → Differentiating). Source investigation: [../PROJECTS_PSA_INVESTIGATION.md](../PROJECTS_PSA_INVESTIGATION.md).

**Coordinator:** [.cursor/plans/projects-psa-coordinator-mission.md](../../.cursor/plans/projects-psa-coordinator-mission.md) · **Skill:** [.cursor/skills/projects-psa-coordinator/SKILL.md](../../.cursor/skills/projects-psa-coordinator/SKILL.md)

**Product boundary:** PSA lives in `spacetimedb/src/projects/` (+ `bill_timesheets` in accounting, expense rebill in expenses). Subscription deferred revenue stays in `subscriptions/` — project POC/milestone rev-rec is a later wave, not a reuse of subscription tables.

## Wave A — Pilot integrity (UI contracts + approve + bill)

- [x] Fix `toCreateProjectParams` `billType` (`customer_project` | `customer_task` | `no`) + expose bill/pricing in project forms
- [x] Fix `toLogTimesheetParams` / timer params (`employeeId`, `currencyId`, `employeeCost` or rate resolution, `encodingUomId`, `timesheetInvoiceType`)
- [x] Align dashboard quick-action IDs (`log_timesheet` / `start_timer` vs `log_time` / `view_timesheets`)
- [x] Enforce `allow_timesheets` / `allow_timesheet_timer` on log/start
- [x] Validate SoD (`validated_by` ≠ logger) + reject/reopen reducers
- [x] Freeze validated/billed rows (reject mutations; optional `project_timesheet_approval` snapshot)
- [x] Separate cost vs sell rate on timesheet; `bill_timesheets` uses sell rate
- [x] Tax compute + period-open gate on `bill_timesheets`
- [x] Bounded SQL: `timesheets-to-validate`, `timesheets-unbilled` + workspace wiring
- [x] Domain suite `run_all_projects_tests` + Playwright `projects-wave-lifecycle.spec.ts`
- [x] CSV: timesheet import Draft-only by default

## Wave B — Competitive productization

- [x] Rate card tables (employee / task / project) + server-side rate resolution
- [x] FX snapshot at validate/bill; company-currency amounts
- [x] Live KPIs from real unbilled/validated hours (not config zeros)
- [ ] Approval timeline UI
- [x] Timer overlap guard (one running timer per employee)
- [x] Expense rebill action surfaced on project UI (calls existing expenses reducer)
- [x] Remove tracker phantoms (`delete_project`, `archive_project`, …) or implement soft-archive only (`set_project_active`)

## Wave C — Capacity & delivery structure

- [x] Working calendar + public holiday tables (pack-keyed seeds for AU/NZ/ZA/SG/…)
- [x] Resource allocation booking table + reducers; wire `hr_resource`
- [x] Leave-aware capacity (approve leave updates remaining capacity)
- [x] Live `resource-capacity-by-employee` subscription
- [x] WBS codes/levels on tasks; milestone entity + task `milestone_id` UI
- [x] Skills matrix (HR competency — not AI skills) for soft staffing match

## Wave D — Project accounting & commercial billing

- [x] `project_margin_snapshot` (or equivalent) + live `project-margin-by-project` SQL
- [x] Project budget link (`crossovered_budget_lines.project_id` or analytic enforce)
- [x] Fixed-fee / milestone billing path
- [x] Utilisation reporting (available vs billable/non-billable)
- [x] Optional WIP/cost JE on validate
- [x] Budget vs actual dashboard wired to live data

## Wave E — Differentiating

- [x] Capacity forecasting (forward allocations vs pipeline)
- [x] Change-order rebaseline (dual baselines + audit)
- [x] Earned value (PV/EV/AC, SPI/CPI)
- [x] Subcontractor PO → project cost → margin
- [x] Project POC/milestone revenue recognition schedules (separate from subscriptions)
- [x] Integration intents (payroll export, calendar sync, e-invoice workers)
- [x] Mobile offline timesheet outbox + conflict UI

## Ops checklist (after each wave that touches schema)

1. [ ] `make generate-stdb-ts-sdk` and `make generate-stdb-rust-sdk` + `make codegen`
2. [ ] Publish module (`spacetime publish … --server local` or project make target)
3. [ ] `spacetime call … run_all_projects_tests --server local`
4. [ ] Playwright: `projects-wave-lifecycle.spec.ts` + `phase-5-workforce-smoke.spec.ts`
5. [ ] Update investigation §7 priority tables when a wave lands

## Notes

- Reuse `bill_timesheets` in `journal_entries.rs` — extend, do not invent a second AR path.
- Reuse expense `create_expense_project_rebill`; do not duplicate rebill in projects.
- Forms: `FormConfig` in `frontend/packages/ui/src/lib/projects-form-configs.ts` + `FormModal` + `ModularForm`.
- Reducers: `.cursor/rules/lumiere-reducer-conventions.mdc` (`*Params`, `write_audit_log_v2`, company guards).
- SpacetimeDB: atomic validate/bill in one reducer txn; calendars/FX/e-invoice HTTP → workers/procedures.
