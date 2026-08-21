---
name: erp-mvp-coordinator
description: >-
  Coordinate parallel Codex sub-agents to execute the ERP MVP plan: CRM
  opportunity lifecycle, live dashboard charts, audit log gaps (P0–P1), and
  domain test harness. Use when the user asks to run the ERP MVP plan, coordinate
  sub-agents, execute Phase 3 quality work, M4 CRM pipeline, or M5 quality gate.
---

# ERP MVP Coordinator

You are the **coordinator agent**. Do not implement all tracks yourself — delegate to sub-agents via the **Task** tool, enforce dependency order, and verify exit criteria before closing a wave.

## Source of truth

| Doc | Role |
|-----|------|
| [.cursor/plans/erp-mvp-coordinator.md](../../plans/erp-mvp-coordinator.md) | Index — tracks, waves, milestones |
| [.cursor/plans/erp-mvp-coordinator-mission.md](../../plans/erp-mvp-coordinator-mission.md) | Orchestrator playbook (read first) |
| Track missions under `.cursor/plans/*-mission.md` | Executable handoff per sub-agent |

Search handle tags with `rg '\[crm-opportunity-lifecycle\]' .cursor` (and sibling handles).

## Coordinator workflow

### 1. Orient (always)

1. Read `erp-mvp-coordinator-mission.md` — current wave and gates.
2. Skim each track mission's **Success criteria** and **Out of scope**.
3. Run quick status probes (coordinator only — do not deep-implement):

```bash
rg 'update_opportunity' spacetimedb/src/crm/opportunities.rs
rg 'write_audit_log_v2' spacetimedb/src/sales/delivery_shipping.rs | wc -l
rg 'Stage \$\{' frontend/web/app/\(modules\)/crm/crm-client.tsx
cargo test --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

### 2. Plan waves (dependency order)

```
Wave 1 (parallel)
├── [crm-opportunity-lifecycle] Phase 1 — backend only
├── [audit-log-gaps] Phase 1 — P0 files
└── [domain-tests-harness] Phase 1 — harness scaffold

Wave 2 (after Wave 1 CRM backend merges)
├── [crm-opportunity-lifecycle] Phase 2 — frontend table path
├── [dashboard-charts-live] Phase 1 — depends on stage name enrichment
├── [audit-log-gaps] Phase 2 — P1
└── [domain-tests-harness] Phase 2 — accounting + sales smoke tests

Wave 3 (optional / stretch)
├── [crm-opportunity-lifecycle] Phase 3 — kanban + DnD
├── [dashboard-charts-live] Phase 2 — analytics/dashboards.rs fate
└── [domain-tests-harness] Phase 3 — inventory valuation tests
```

**Hard dependency:** `[dashboard-charts-live]` CRM pipeline labels require `[crm-opportunity-lifecycle]` client-side `stageName` (or equivalent join) — do not spawn dashboard CRM chart work before CRM frontend Phase 2 starts.

### 3. Spawn sub-agents

Use **Task** with `subagent_type: generalPurpose`. One sub-agent per track per wave. Pass the full track mission path and explicit phase scope.

**Sub-agent prompt template:**

```
You are executing track [HANDLE] for the Lumiere ERP MVP plan.

Read and follow ONLY:
- .cursor/plans/<track>-mission.md — Phase N (<phase name>)

Rules:
- SpacetimeDB reducers: follow .cursor/rules/lumiere-reducer-conventions.mdc
- Frontend forms: FormConfig + FormModal + ModularForm (no ad-hoc Dialog CRUD)
- Smallest correct diff; do not expand scope beyond mission Out of scope
- After backend reducer/table changes: spacetime generate + fix TypeScript bindings
- Run verification commands listed in mission Phase N before finishing

Return:
1. Files changed (paths)
2. Verification command outputs (pass/fail)
3. Blockers for next phase
4. Whether success criteria for this phase are met (checklist)
```

**Parallelism:** Launch Wave 1 tracks in a **single message** with multiple Task calls when dependencies allow.

### 4. Integrate & gate

After sub-agents return:

1. **Conflict check** — same file edited by two tracks → reconcile or re-serialize.
2. **Bindings** — if any `spacetimedb/src/**/*.rs` reducer changed, ensure `spacetime generate` ran and TS compiles.
3. **Wave gate** — run commands from `erp-mvp-coordinator-mission.md` § Wave gates.
4. Update coordinator mission with wave status (checkboxes) if the user wants persistent tracking.

Do **not** mark M4/M5 complete until all track exit criteria pass.

### 5. Milestone mapping

| Milestone | Tracks | Exit signal |
|-----------|--------|-------------|
| **M4: CRM pipeline** | `[crm-opportunity-lifecycle]` + `[dashboard-charts-live]` CRM widgets | Create → stage move → won/lost → convert SO closes opp; chart shows stage names |
| **M5: Quality gate** | `[audit-log-gaps]` P0/P1 + `[domain-tests-harness]` top 3 paths | P0 audit coverage; `cargo test` green for accounting/inventory/sales suites |

## Sub-agent track handles

| Handle | Mission file | Owner focus |
|--------|--------------|-------------|
| `[crm-opportunity-lifecycle]` | `crm-opportunity-lifecycle-mission.md` | Backend reducers + CRM UI + optional kanban |
| `[dashboard-charts-live]` | `dashboard-charts-live-mission.md` | Static placeholder cleanup + live chart labels |
| `[audit-log-gaps]` | `audit-log-gaps-mission.md` | `write_audit_log_v2` on missing reducers |
| `[domain-tests-harness]` | `domain-tests-harness-mission.md` | Test harness + revenue-path suites |

## Coordinator anti-patterns

- **Do not** implement kanban before table-path exit criteria (stage select, won/lost, edit modal).
- **Do not** spawn dashboard CRM chart sub-agent before `stageName` enrichment exists.
- **Do not** batch all audit P0–P3 into one sub-agent — use phased P0 → P1 → P2.
- **Do not** skip `spacetime generate` after reducer signature changes.
- **Do not** commit unless the user explicitly asks.

## When user says "run the plan"

1. Read coordinator mission.
2. Report current wave + which tracks are blocked.
3. Spawn Wave 1 sub-agents (or next incomplete wave).
4. Summarize results and next wave.
