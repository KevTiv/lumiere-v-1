# [projects-psa-coordinator] Mission — orchestrator playbook

**Handle:** `[projects-psa-coordinator]`

## Goal

Coordinate **sub-agents** (via Task tool) to close gaps from [docs/PROJECTS_PSA_INVESTIGATION.md](../../docs/PROJECTS_PSA_INVESTIGATION.md) in wave order: pilot integrity → rates/productization → capacity/delivery → project accounting → differentiating PSA. The coordinator verifies wave gates; sub-agents implement.

## Why this exists

Investigation found a thin project shell with **broken UI contracts** (invalid `bill_type`, incomplete timesheet params), non-immutable validation, and cost-as-price billing without tax. Parallel tracks exist once Wave A soft deps are respected; capacity/margin work must not start before create→log→validate→bill is trustworthy.

## Primary artifacts

| Artifact | Path |
|----------|------|
| Investigation | `docs/PROJECTS_PSA_INVESTIGATION.md` |
| Tracker | `docs/plans/projects-psa-gap-fixes-plan.md` |
| Coordinator skill | `.cursor/skills/projects-psa-coordinator/SKILL.md` |
| Projects backend | `spacetimedb/src/projects/` |
| Bill timesheets | `spacetimedb/src/accounting/journal_entries.rs` |
| UI client | `frontend/web/app/(modules)/projects/projects-client.tsx` |
| Param mappers | `frontend/web/lib/projects-create-params.ts` |
| Form configs | `frontend/packages/ui/src/lib/projects-form-configs.ts` |
| BFF / workspace | `frontend/packages/stdb/src/commands/projects-http.ts`, `subscriptions/projects-workspace.ts` |

## Phase 0 — Coordinator bootstrap (every session)

1. Read this file + tracker checkboxes.
2. Determine lowest incomplete **wave**.
3. Spawn sub-agents per skill § Spawn sub-agents.
4. After return: resolve conflicts, confirm bindings, run wave gate.
5. Report: wave status, blockers, next wave.

## Wave status

| Wave | Status | Notes |
|------|--------|-------|
| A — Pilot integrity | **Gate ready** | Static gate green; publish + `run_all_projects_tests` + Playwright still required for runtime proof |
| B — Rates / productization | **Gate ready** | Static gate green 2026-07-18; leftover: approval timeline UI |
| C — Capacity / delivery | **Gate ready** | Static gate green 2026-07-18; capacity via `resource_capacity_snapshot`; publish + `run_projects_wave_c_test` still ops |
| D — Project accounting | **Gate ready** | Static gate green 2026-07-18; margin snapshot + milestone bill + utilisation + WIP flag; publish + `run_projects_wave_d_test` still ops |
| E — Differentiating | **Gate ready** | Static gate green 2026-07-18; forecast/CO/EVM/subcon/rev-rec/intents/outbox; publish + `run_projects_wave_e_test` still ops |

## Wave gates

### Wave A gate

```bash
rg "billType: 'non_billable'" frontend/web/lib/projects-create-params.ts && echo FAIL || echo OK
rg 'employeeId' frontend/web/lib/projects-create-params.ts
rg 'reject_timesheet|reopen_timesheet' spacetimedb/src/projects/timesheets.rs
rg 'amount_tax' spacetimedb/src/accounting/journal_entries.rs
rg 'timesheets-to-validate|timesheets-unbilled' frontend/packages/stdb/src/
test -f frontend/web/tests/e2e/projects-wave-lifecycle.spec.ts && echo OK
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

- [x] Wave A gate passed (static checks 2026-07-18; runtime publish/call/Playwright pending ops checklist)

### Wave B gate

```bash
rg 'rate_card|ProjectRate|resolve_.*rate' spacetimedb/src/projects/ --glob '*.rs' | head -15
rg 'create_expense_project_rebill' frontend/web/app/\(modules\)/projects/
```

- [x] Wave B gate passed (static checks 2026-07-18; runtime publish/call/Playwright still on ops checklist)

### Wave C–E gates

See skill § Wave gate commands. Mark tracker checkboxes when green.

- [x] Wave C gate passed (static checks 2026-07-18; `working_calendar`/`public_holiday`/`resource_allocation` + `resource-capacity` subscription; runtime publish/`run_projects_wave_c_test` still on ops checklist)

### Wave D gate

```bash
rg 'project_margin|margin_snapshot' spacetimedb/src/ --glob '*.rs' | head -20
rg 'project-margin' frontend/packages/stdb/src/
rg 'bill_project_milestone' spacetimedb/src/
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

- [x] Wave D gate passed (static checks 2026-07-18; runtime publish/`run_projects_wave_d_test` still on ops checklist)

### Wave E gate

```bash
rg 'change_order|earned_value|subcontractor|project_revenue' spacetimedb/src/ --glob '*.rs' | head -20
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

- [x] Wave E gate passed (static checks 2026-07-18; runtime publish/`run_projects_wave_e_test` still on ops checklist)

## Parallelization matrix

| Slot | Wave A | Wave B | Wave C | Wave D | Wave E |
|------|--------|--------|--------|--------|--------|
| **UI agent** | `[psa-ui-contracts]` | rates UI / KPIs (shared with rates track) | milestone/WBS UI | margin dashboard | advanced UI |
| **Time/approval agent** | `[psa-time-approval]` | timer overlap (or rates track) | — | WIP on validate | — |
| **Billing agent** | `[psa-billing-integrity]` *(after sell_rate)* | `[psa-rates-productization]` | — | `[psa-project-accounting]` | `[psa-advanced]` rev-rec |
| **Ops/tests agent** | `[psa-ops-inbox-tests]` *(last)* | — | `[psa-capacity-delivery]` | utilisation tests | integration intents |

## Sub-agent spawn checklist

For each spawn, include:

1. Track handle + mission path + **phase number only**
2. Link to `lumiere-reducer-conventions.mdc` for backend
3. Form-builder rule for frontend
4. Required verification commands from that phase
5. Explicit **out of scope** from track mission

## Anti-patterns

- Do not invent a second AR billing reducer — extend `bill_timesheets`.
- Do not put project rev-rec into subscription deferred tables.
- Do not spawn Wave C before Wave A gate.
- Do not commit unless the user asks.

## Related

- Skill: [.cursor/skills/projects-psa-coordinator/SKILL.md](../skills/projects-psa-coordinator/SKILL.md)
- Tracker: [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)
- Expenses rebill adjacency: [docs/EXPENSES_INVESTIGATION.md](../../docs/EXPENSES_INVESTIGATION.md)
