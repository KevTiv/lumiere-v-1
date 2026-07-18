# [psa-time-approval] Mission — validate SoD, freeze, sell/cost rates

**Handle:** `[psa-time-approval]`  
**Wave:** A  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Turn timesheet validation into an approval with SoD, reject/reopen, and immutable approved/billed snapshots. Introduce distinct **cost** vs **sell** rate fields on `project_timesheet` so billing can stop using cost as price.

**Exit criteria:** Self-validate blocked; validated/billed rows reject mutation; reject + reopen reducers exist with audit; timesheets store `employee_cost` (cost) and sell rate (name TBD, e.g. `unit_amount_sell` / `sell_rate`).

## Why this exists

Investigation: `validate_timesheets` flips `validation_status` with no SoD, no freeze, no snapshot. `amount` / `timesheet_revenue` both use `employee_cost`.

## Primary artifacts

| Artifact | Path |
|----------|------|
| Timesheets | `spacetimedb/src/projects/timesheets.rs` |
| Types | `spacetimedb/src/types.rs` |
| Imports | `spacetimedb/src/data_ops/project_imports.rs` |
| Seed | `spacetimedb/src/seed.rs` (timesheet samples) |
| Conventions | `.cursor/rules/lumiere-reducer-conventions.mdc` |

## Out of scope

- Tax / period lock on invoice (`[psa-billing-integrity]`)
- Rate card catalogue (`[psa-rates-productization]`)
- UI forms beyond minimal hook wiring if needed for new reducers
- Capacity / calendars

---

## Phase 1 — Schema + validate harden + freeze

### 1.1 Schema

On `ProjectTimesheet` (and create params):

- Keep `employee_cost` as **cost** rate.
- Add `sell_rate: f64` (or equivalent SpacetimeType field).
- Compute `amount` from cost×hours for internal cost; `timesheet_revenue` from sell×hours.
- Optional append-only `project_timesheet_approval` table (actor, decision, reason, hours, sell_rate, cost_rate, currency_id, timestamp) — preferred for audit timeline.

### 1.2 Log / timer

- Enforce `project.allow_timesheets` / `allow_timesheet_timer`.
- Accept sell_rate from params (or default = employee_cost until Wave B).
- Reject log when project inactive / wrong company (keep existing guards).

### 1.3 Validate

- Require `validation_status == "draft"` (or submitted if you introduce submit).
- SoD: `ctx.sender() != entry.user_id` (logger) — document if manager_id preferred later.
- Write approval snapshot; set `validated_by` / `validated_at`.
- Permission: keep `validate` action.

### 1.4 Freeze

- No update reducer today — add guards on any path that mutates hours (stop timer, import, future update): reject if `validated` or `timesheet_invoice_id.is_some()`.
- `stop_timesheet_timer` must not run on validated rows.

### Verify Phase 1

```bash
rg 'sell_rate|timesheet_revenue' spacetimedb/src/projects/timesheets.rs
rg 'allow_timesheets' spacetimedb/src/projects/timesheets.rs
rg 'validated_by|user_id' spacetimedb/src/projects/timesheets.rs
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -8
```

### Success criteria

- [x] Sell vs cost fields on timesheet
- [x] SoD on validate
- [x] Validated/billed immutable against timer/import mutation
- [x] `write_audit_log_v2` on validate
- [x] `cargo check` passes

---

## Phase 2 — Reject / reopen

### 2.1 Reducers

- `reject_timesheets(organization_id, params)` — draft/submitted → rejected with reason; audit.
- `reopen_timesheets` — validated **unbilled** → draft; billed hard-fail.
- Params structs + permissions + company guards.

### 2.2 Generate bindings

Run spacetime generate; wire BFF keys + query-hooks if UI will call (minimal: hooks + BFF; UI toolbar can be ops track).

### Verify Phase 2

```bash
rg 'reject_timesheet|reopen_timesheet' spacetimedb/src/projects/timesheets.rs
rg 'reject_timesheets|reopen_timesheets' frontend/packages/stdb/src/commands/projects-http.ts
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

### Success criteria

- [x] Reject + reopen reducers with company guards + audit
- [x] Billed reopen blocked
- [x] BFF keys updated (no phantoms)
