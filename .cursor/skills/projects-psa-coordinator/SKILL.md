---
name: projects-psa-coordinator
description: >-
  Coordinate parallel Cursor sub-agents to close Projects/PSA gaps from
  PROJECTS_PSA_INVESTIGATION.md: Wave A UI contracts/time approval/billing,
  Wave B rates/FX/KPIs, Wave C capacity/calendars/WBS, Wave D margin/budgets,
  Wave E EVM/change-orders/subcontractors. Use when the user asks to run the
  PSA plan, projects gap fixes, or spawn PSA sub-agents.
---

# Projects / PSA Coordinator

You are the **coordinator agent** for Lumiere **Projects & PSA gap closure**. Do not implement all tracks yourself — delegate via the **Task** tool, enforce wave dependency order, and verify exit criteria before closing a wave.

## Source of truth

| Doc | Role |
|-----|------|
| [docs/PROJECTS_PSA_INVESTIGATION.md](../../../docs/PROJECTS_PSA_INVESTIGATION.md) | Gap matrix, invariants, architecture |
| [docs/plans/projects-psa-gap-fixes-plan.md](../../../docs/plans/projects-psa-gap-fixes-plan.md) | Checkbox tracker |
| [.cursor/plans/projects-psa-coordinator-mission.md](../../plans/projects-psa-coordinator-mission.md) | Orchestrator playbook |
| Track missions under `.cursor/plans/psa-*-mission.md` | Executable handoff per sub-agent |

Search handle tags with `rg '\[psa-ui-contracts\]' .cursor` (and sibling handles).

## Coordinator workflow

### 1. Orient (always)

1. Read the coordinator mission — current wave and gates.
2. Skim each active track mission’s **Success criteria** and **Out of scope**.
3. Quick probes:

```bash
rg "billType: 'non_billable'|billType: \"non_billable\"" frontend/web/lib/projects-create-params.ts && echo FAIL || echo OK
rg 'employeeId|encodingUomId|timesheetInvoiceType' frontend/web/lib/projects-create-params.ts
rg 'validation_status|reject_timesheet|project_timesheet_approval' spacetimedb/src/projects/timesheets.rs
rg 'amount_tax|sell_rate|employee_cost' spacetimedb/src/accounting/journal_entries.rs
rg 'timesheets-to-validate|timesheets-unbilled' frontend/packages/stdb/src/
```

### 2. Plan waves (dependency order)

```
Wave A (pilot — parallel with soft deps)
├── [psa-ui-contracts] Phase 1 — bill_type + timesheet mappers + quick actions
├── [psa-time-approval] Phase 1 — SoD, reject/reopen, freeze + sell/cost fields
└── [psa-billing-integrity] Phase 1 — AFTER sell_rate exists: tax + period lock + bill uses sell rate
    └── [psa-ops-inbox-tests] Phase 1 — AFTER A tracks: queues + domain + Playwright

Wave B (after Wave A gate)
└── [psa-rates-productization] — rate cards, FX, KPIs, timer overlap, expense rebill UI

Wave C (after Wave B gate)
└── [psa-capacity-delivery] — calendars, holidays, allocations, WBS/milestones, skills

Wave D (after Wave C gate)
└── [psa-project-accounting] — margin live view, budgets, milestone bill, utilisation, WIP

Wave E (after Wave D gate — differentiating)
└── [psa-advanced] — forecast, change orders, EVM, subcontractors, project rev-rec, integrations
```

**Hard dependencies:**

- `[psa-billing-integrity]` needs timesheet sell/cost fields from `[psa-time-approval]` (or land rate columns in the same Phase 1 backend PR first).
- `[psa-ops-inbox-tests]` after UI contracts + validate + bill paths are callable.
- Do **not** spawn Wave C calendars before Wave A billing integrity merges (capacity without billable truth wastes effort).
- Do **not** touch `subscriptions/` deferred revenue tables for project rev-rec (Wave E owns a separate schedule).

### 3. Spawn sub-agents

Use **Task** with `subagent_type: generalPurpose`. One sub-agent per track per phase batch.

**Sub-agent prompt template:**

```
You are executing track [HANDLE] for Lumiere Projects/PSA gap fixes.

Read and follow ONLY:
- .cursor/plans/<track>-mission.md — Phase N (<phase name>)
- docs/PROJECTS_PSA_INVESTIGATION.md — §2 gap matrix + §6 architecture (context)
- docs/plans/projects-psa-gap-fixes-plan.md — check off completed items when done

Rules:
- SpacetimeDB reducers: .cursor/rules/lumiere-reducer-conventions.mdc
- Frontend forms: FormConfig in frontend/packages/ui/src/lib/projects-form-configs.ts
  (NOT frontend/web/lib/) + FormModal + ModularForm
- Mappers: frontend/web/lib/projects-create-params.ts; stdbParamsToJson where required
- Smallest correct diff; do not expand beyond mission Out of scope
- After backend reducer/table changes: spacetime generate + fix TypeScript bindings
- Run verification commands listed in mission Phase N before finishing

Return:
1. Files changed (paths)
2. Verification command outputs (pass/fail)
3. Blockers for next phase
4. Whether success criteria for this phase are met (checklist)
```

**Parallelism:** Launch independent Wave A tracks in a **single message** with multiple Task calls. Serialize `[psa-billing-integrity]` after sell-rate fields exist.

### 4. Integrate & gate

After sub-agents return:

1. **Conflict check** — same file edited by two tracks → reconcile.
2. **Bindings** — if `spacetimedb/src/projects/**` or `bill_timesheets` changed, ensure `spacetime generate` ran.
3. **Wave gate** — run commands from coordinator mission.
4. Update tracker checkboxes if the user wants persistent tracking.

### 5. Wave gate commands

#### Wave A gate

```bash
rg "billType: 'non_billable'" frontend/web/lib/projects-create-params.ts && echo FAIL || echo OK
rg 'employeeId' frontend/web/lib/projects-create-params.ts
rg 'reject_timesheet|reopen_timesheet|validated_by' spacetimedb/src/projects/timesheets.rs
rg 'amount_tax' spacetimedb/src/accounting/journal_entries.rs
rg 'timesheets-to-validate|timesheets-unbilled' frontend/packages/stdb/src/
test -f frontend/web/tests/e2e/projects-wave-lifecycle.spec.ts && echo OK
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
cd frontend/web && pnpm exec tsc --noEmit 2>&1 | tail -5
```

#### Wave B gate

```bash
rg 'rate_card|project_rate|resolve.*rate' spacetimedb/src/projects/ --glob '*.rs'
rg 'currency_rate|fx' spacetimedb/src/projects/timesheets.rs
rg 'create_expense_project_rebill' frontend/web/app/\(modules\)/projects/
```

#### Wave C gate

```bash
rg 'working_calendar|public_holiday|resource_allocation' spacetimedb/src/ --glob '*.rs' | head -20
rg 'resource-capacity' frontend/packages/stdb/src/
rg 'milestone' spacetimedb/src/projects/ --glob '*.rs' | head -15
```

#### Wave D gate

```bash
rg 'project_margin|utilisation|utilization' spacetimedb/src/projects/ frontend/packages/stdb/src/ | head -20
rg 'project_id' spacetimedb/src/accounting/budgeting.rs
```

#### Wave E gate

```bash
rg 'change_order|earned_value|subcontractor|project_revenue' spacetimedb/src/ --glob '*.rs' | head -20
```

## Sub-agent track handles

| Handle | Mission file | Wave | Focus |
|--------|--------------|------|-------|
| `[psa-ui-contracts]` | `psa-ui-contracts-mission.md` | A | bill_type, timesheet mappers, quick actions, forms |
| `[psa-time-approval]` | `psa-time-approval-mission.md` | A | SoD, freeze, reject/reopen, sell/cost fields |
| `[psa-billing-integrity]` | `psa-billing-integrity-mission.md` | A | tax, period lock, bill uses sell rate |
| `[psa-ops-inbox-tests]` | `psa-ops-inbox-tests-mission.md` | A | queues, domain tests, Playwright |
| `[psa-rates-productization]` | `psa-rates-productization-mission.md` | B | rate cards, FX, KPIs, rebill UI |
| `[psa-capacity-delivery]` | `psa-capacity-delivery-mission.md` | C | calendars, allocation, WBS, milestones |
| `[psa-project-accounting]` | `psa-project-accounting-mission.md` | D | margin, budgets, milestone bill, utilisation |
| `[psa-advanced]` | `psa-advanced-mission.md` | E | EVM, change orders, subcontractors, rev-rec |

## Coordinator anti-patterns

- **Do not** greenfield a second invoice path — extend `bill_timesheets`.
- **Do not** put project rev-rec into `subscriptions/` tables.
- **Do not** skip `spacetime generate` after reducer/table changes.
- **Do not** add forms under `frontend/web/lib/*-form-configs.ts`.
- **Do not** spawn Wave C+ before Wave A gate (broken create/log wastes capacity work).
- **Do not** commit unless the user explicitly asks.

## When user says "run the plan"

1. Read coordinator mission + tracker.
2. Report current wave + blocked tracks.
3. Spawn next incomplete wave’s sub-agents with phase scope.
4. After return: run wave gate, summarize pass/fail, recommend next wave.
