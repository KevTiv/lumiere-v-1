# [psa-rates-productization] Mission — rate cards, FX, KPIs, rebill UI

**Handle:** `[psa-rates-productization]`  
**Wave:** B  
**Depends on:** Wave A gate  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Server-side rate resolution from rate cards, FX snapshot at validate/bill, live KPIs from real queues, timer overlap guard, and surface expense project rebill in Projects UI.

## Primary artifacts

- New tables under `spacetimedb/src/projects/` (e.g. `project_rate_card` / lines)
- `timesheets.rs` rate resolution helper
- `projects-client.tsx` + form configs
- Expense reducer `create_expense_project_rebill` (call only — do not reimplement)
- `module-dashboard-configs.ts` KPIs

## Out of scope

- Working calendars / allocations (Wave C)
- Margin snapshot engine (Wave D)
- Milestone billing (Wave D)

---

## Phase 1 — Rate cards + resolution

1. Tables: rate card header/lines (employee / task / project scope, currency, cost_rate, sell_rate, effective dates).
2. Reducers: create/update rate card (+ lines) with `*Params`, company guards, audit.
3. On `log_timesheet` / validate: resolve rates server-side when client omits; never trust client sell_rate alone for billable projects when a card matches.
4. UI: minimal rate card tab or settings section + FormConfig.

### Verify

```bash
rg 'rate_card|sell_rate|resolve' spacetimedb/src/projects/ --glob '*.rs' | head -25
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

---

## Phase 2 — FX, KPIs, timer, rebill UI, phantoms

1. Snapshot FX at validate (and bill if missing) → company currency amounts.
2. Dashboard KPIs from `timesheets-to-validate` / unbilled / hours — not static zeros.
3. Reject second running timer for same employee.
4. Projects UI action → `create_expense_project_rebill` for posted expense sheets linked to project.
5. Clean `track-reducer-coverage.ts` phantoms (`delete_project`, etc.) or implement `set_project_active` as archive only.

### Success criteria

- [x] Rate card CRUD + server resolution
- [x] FX fields snapshotted
- [x] Live KPIs
- [x] Timer overlap guard
- [x] Expense rebill reachable from Projects
- [x] Bindings + tsc OK
