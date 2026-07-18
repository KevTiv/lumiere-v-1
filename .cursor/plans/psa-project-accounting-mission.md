# [psa-project-accounting] Mission — margin, budgets, milestone bill, utilisation

**Handle:** `[psa-project-accounting]`  
**Wave:** D  
**Depends on:** Wave C gate  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Live project-margin views, project-linked budgets, fixed-fee/milestone billing, utilisation reporting, optional WIP on validate, and dashboard budget-vs-actual from live data.

## Primary artifacts

- `project_margin_snapshot` (or maintained projection) + SQL `project-margin-by-project`
- `spacetimedb/src/accounting/budgeting.rs` — add `project_id` or enforce analytic↔project
- Milestone bill reducer (extend billing, do not fork AR model)
- Utilisation report reducer or bounded SQL + UI tab
- Optional WIP JE helper shared with accounting
- Dashboard overrides in `projects-client.tsx`

## Out of scope

- EVM / change orders / subcontractors (Wave E)
- Subscription deferred revenue tables
- Replacing `bill_timesheets` T&M path

---

## Phase 1 — Margin snapshot + live SQL + dashboard

1. On validate/bill/expense-rebill: update project margin snapshot (revenue, cost, expenses, margin %).
2. Bounded subscription + UI panel replacing empty budget widget.
3. Drill-down: project → timesheets / invoices / expense rebill moves.

### Verify

```bash
rg 'project_margin|margin_snapshot' spacetimedb/src/ --glob '*.rs' | head -20
rg 'project-margin' frontend/packages/stdb/src/
```

---

## Phase 2 — Budgets, milestone bill, utilisation, WIP

1. Budget lines link to `project_id` (or require project analytic).
2. `bill_project_milestone` (or params on bill) creates AR from milestone amount/% complete.
3. Utilisation: available (calendar) vs billable/non-billable hours by employee/period.
4. Optional: WIP JE when validating billable time (feature-flagged / project allow flag).

### Success criteria

- [x] Live margin updates without full-table client scan
- [x] Budget vs actual on project dashboard
- [x] Milestone/fixed bill path + audit
- [x] Utilisation view or report
- [x] Domain tests for margin math isolation
