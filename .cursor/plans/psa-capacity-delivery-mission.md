# [psa-capacity-delivery] Mission — calendars, allocation, WBS, milestones

**Handle:** `[psa-capacity-delivery]`  
**Wave:** C  
**Depends on:** Wave B gate  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Country-pack-aware working calendars and public holidays, resource allocation bookings wired to `hr_resource`, leave-aware capacity, live capacity subscription, WBS codes, and a real milestone entity.

## Primary artifacts

- New: `working_calendar`, `public_holiday`, `resource_allocation` (names flexible)
- Adjacent: `spacetimedb/src/hr/employees.rs` (`hr_resource`), `hr/leaves.rs`
- Tasks: `spacetimedb/src/projects/tasks.rs` (WBS fields, `milestone_id`)
- New milestone table + reducers
- Subscriptions: `resource-capacity-by-employee`
- UI: resources / gantt panels → real booking UX (FormConfig)

## Out of scope

- EVM / change orders (Wave E)
- Project margin engine (Wave D) — capacity feed only
- AI skills registry (not HR competencies)

---

## Phase 1 — Calendars + holidays + allocations

1. Calendar + holiday tables; seed minimal packs (au, nz, za, sg) — metadata dates OK for pilot.
2. Allocation booking: employee/resource, project/task, date range, hours/% .
3. On leave approve: reduce remaining capacity (same txn or documented hook).
4. Live SQL: available hours − leave − allocations − actual timesheet hours.
5. Wire `hr_resource` into projects workspace reads.

### Verify

```bash
rg 'working_calendar|public_holiday|resource_allocation' spacetimedb/src/ --glob '*.rs' | head -30
rg 'resource-capacity' frontend/packages/stdb/src/
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

---

## Phase 2 — WBS + milestones + skills

1. Task WBS code / level fields; validate parent hierarchy.
2. `project_milestone` table + CRUD; task `milestone_id` UI picker.
3. HR skills matrix tables (employee ↔ skill ↔ level) — separate from `ai_skill`.
4. Soft match hint in allocation UI (optional).

### Success criteria

- [x] Calendars/holidays seeded for ≥1 pack per region group (`seed_pack_holidays`: au/nz/za/sg; BR municipal overlays noted deferred)
- [x] Allocation CRUD + capacity subscription (`resource-capacity-by-employee` → `resource_capacity_snapshot` materialisation)
- [x] Milestone entity + task link in UI
- [x] WBS code on tasks
- [x] Domain smoke for over-allocation reject (if enforced) — `run_projects_wave_c_test`

### Capacity projection note

Live SQL cannot compute available − leave − allocations − actual across tables. Remaining capacity is materialised in `resource_capacity_snapshot` and refreshed in the same txn on allocation CRUD and `approve_leave`.
