---
name: hr-payroll-coordinator
description: >-
  Coordinate parallel Codex sub-agents to close HR/Payroll gaps from
  HR_PAYROLL_INVESTIGATION.md: Wave A PII/leave/guards/UI/payroll-pack/tests,
  Wave B onboarding/docs/attendance/comp/localization, Wave C performance/
  benefits/partners. Use when the user asks to run the HR plan, payroll gap
  fixes, or spawn HR sub-agents.
---

# HR & Payroll Coordinator

You are the **coordinator agent** for Lumiere **HR & Payroll gap closure**. Do not implement all tracks yourself — delegate via the **Task** tool, enforce wave dependency order, and verify exit criteria before closing a wave.

## Source of truth

| Doc | Role |
|-----|------|
| [docs/HR_PAYROLL_INVESTIGATION.md](../../../docs/HR_PAYROLL_INVESTIGATION.md) | Gap matrix, invariants, architecture, localization |
| [docs/plans/hr-payroll-gap-fixes-plan.md](../../../docs/plans/hr-payroll-gap-fixes-plan.md) | Checkbox tracker |
| [.cursor/plans/hr-payroll-coordinator-mission.md](../../plans/hr-payroll-coordinator-mission.md) | Orchestrator playbook |
| Track missions under `.cursor/plans/hr-*-mission.md` | Executable handoff per sub-agent |

Search handle tags with `rg '\[hr-pii-access\]' .cursor` (and sibling handles).

## Coordinator workflow

### 1. Orient (always)

1. Read the coordinator mission — current wave and gates.
2. Skim each active track mission’s **Success criteria** and **Out of scope**.
3. Quick probes:

```bash
rg 'account_move|AccountMove|hr_payroll_export_intent' spacetimedb/src/hr/
rg 'submit_leave|hr_leave_allocation|max_leaves' spacetimedb/src/hr/leaves.rs
rg 'job-positions|leave-types|payroll-structures|salary-rules' frontend/packages/stdb/src/queries/erp-subscriptions.ts
rg 'hr_pii_access|view_comp|defaultRestricted' frontend/packages/stdb/src/ frontend/packages/stdb/src/generated/query-registry.ts
rg 'state === "Confirm"|state === .Confirm' frontend/web/app/\(modules\)/hr/
test -f frontend/web/tests/e2e/hr-wave-lifecycle.spec.ts && echo OK || echo MISSING
```

### 2. Plan waves (dependency order)

```
Wave A (pilot — parallel with soft deps)
├── [hr-pii-access] Phase 1 — purpose scopes + masking + read audit
├── [hr-leave-integrity] Phase 1 — submit, allocations, refuse guards, SoD
├── [hr-guards-sm] Phase 1 — company guards + contract/leave/payslip from-state
├── [hr-ui-subscriptions] Phase 1 — ERP_ORG_SQL + update UI + KPI (soft: after submit_leave)
├── [hr-payroll-pack] Phase 1 — Done-without-artifact forbidden + export intent (+ optional GL)
└── [hr-lifecycle-tests] Phase 1 — AFTER A tracks: offboarding checklist + domain + Playwright

Wave B (after Wave A gate)
├── [hr-onboarding-docs] — onboarding checklists + employee document vault
├── [hr-attendance-comp] — attendance/schedules MVP + compensation effective dating
└── [hr-pack-localization] — pack leave/holiday/ID overlays + CSV harden + queues UI

Wave C (after Wave B gate — differentiating)
└── [hr-advanced] — performance, benefits, partner payroll hooks, advanced WFM
```

**Hard dependencies:**

- `[hr-lifecycle-tests]` after leave + payroll-pack paths are callable (and preferably PII scopes landed so tests assert masking).
- `[hr-ui-subscriptions]` KPI fix needs `submit_leave` → `Confirm` from `[hr-leave-integrity]` (or temporarily count pending = Confirm|Draft-submitted — prefer real submit).
- `[hr-payroll-pack]` must **not** implement universal salary-rule execution.
- Do **not** spawn Wave B attendance before Wave A leave balances exist (conflict checks need allocations).
- Do **not** call government/bank HTTP from reducers — intents only.

### 3. Spawn sub-agents

Use **Task** with `subagent_type: generalPurpose`. One sub-agent per track per phase batch.

**Sub-agent prompt template:**

```
You are executing track [HANDLE] for Lumiere HR/Payroll gap fixes.

Read and follow ONLY:
- .cursor/plans/<track>-mission.md — Phase N (<phase name>)
- docs/HR_PAYROLL_INVESTIGATION.md — §2 gap matrix + §3 invariants + §6 architecture
- docs/plans/hr-payroll-gap-fixes-plan.md — check off completed items when done

Rules:
- SpacetimeDB reducers: .cursor/rules/lumiere-reducer-conventions.mdc
- Frontend forms: FormConfig in frontend/packages/ui/src/lib/hr-form-configs.ts
  (NOT frontend/web/lib/) + FormModal + ModularForm
- Mappers: frontend/web/lib/hr-create-params.ts; stdbParamsToJson where required
- Payroll = country-pack + export intents — NEVER a universal gross-to-net engine
- Strict PII: no widening org-wide sensitive subscriptions; purpose scopes + masking
- Smallest correct diff; do not expand beyond mission Out of scope
- After backend reducer/table changes: spacetime generate + fix TypeScript bindings
- Run verification commands listed in mission Phase N before finishing

Return:
1. Files changed (paths)
2. Verification command outputs (pass/fail)
3. Blockers for next phase
4. Whether success criteria for this phase are met (checklist)
```

**Parallelism:** Launch independent Wave A tracks (`hr-pii-access`, `hr-leave-integrity`, `hr-guards-sm`, `hr-payroll-pack`) in a **single message**. Soft-serialize UI KPI after leave submit; serialize `[hr-lifecycle-tests]` last.

### 4. Integrate & gate

After sub-agents return:

1. **Conflict check** — same file edited by two tracks → reconcile (`hr/leaves.rs`, `hr-client.tsx`, `erp-subscriptions.ts` are hot files).
2. **Bindings** — if `spacetimedb/src/hr/**` changed, ensure `spacetime generate` ran.
3. **Wave gate** — run commands from coordinator mission.
4. Update tracker checkboxes if the user wants persistent tracking.

### 5. Wave gate commands

#### Wave A gate

```bash
rg 'submit_leave|hr_leave_allocation' spacetimedb/src/hr/leaves.rs
rg 'hr_payroll_export_intent|account_move_id|ApprovedForExport' spacetimedb/src/hr/payroll.rs
rg 'job-positions|leave-types|payroll-structures|salary-rules' frontend/packages/stdb/src/queries/erp-subscriptions.ts
rg 'hr_pii_access|view_comp' spacetimedb/src/hr/ frontend/packages/stdb/src/ || true
rg 'useUpdateEmployee|update_employee' frontend/web/app/\(modules\)/hr/hr-client.tsx
test -f frontend/web/tests/e2e/hr-wave-lifecycle.spec.ts && echo OK
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -8
# Prefer: spacetime call <db> run_all_hr_tests --server local
```

#### Wave B gate

```bash
rg 'hr_onboarding|employee_document|hr_attendance|compensation_event' spacetimedb/src/hr/
rg 'leaves-to-approve|payslips-to-export' frontend/packages/stdb/src/
rg 'write_audit_log_v2' spacetimedb/src/data_ops/hr_imports.rs
```

#### Wave C gate

```bash
rg 'performance|benefit|hr_integration_intent' spacetimedb/src/hr/
```

## Sub-agent track handles

| Handle | Mission file | Wave | Owner focus |
|--------|--------------|------|-------------|
| `[hr-pii-access]` | `hr-pii-access-mission.md` | A | Purpose scopes, masking, read audit |
| `[hr-leave-integrity]` | `hr-leave-integrity-mission.md` | A | Submit, balances, refuse, SoD |
| `[hr-guards-sm]` | `hr-guards-sm-mission.md` | A | Company guards + SM from-state |
| `[hr-ui-subscriptions]` | `hr-ui-subscriptions-mission.md` | A | ERP_ORG_SQL, update UI, KPI |
| `[hr-payroll-pack]` | `hr-payroll-pack-mission.md` | A | Export intent / GL; no engine |
| `[hr-lifecycle-tests]` | `hr-lifecycle-tests-mission.md` | A | Offboarding + domain + Playwright |
| `[hr-onboarding-docs]` | `hr-onboarding-docs-mission.md` | B | Onboarding + documents |
| `[hr-attendance-comp]` | `hr-attendance-comp-mission.md` | B | Attendance + compensation history |
| `[hr-pack-localization]` | `hr-pack-localization-mission.md` | B | Pack overlays, CSV, queues |
| `[hr-advanced]` | `hr-advanced-mission.md` | C | Performance, benefits, partners |

## Coordinator anti-patterns

- **Do not** build a universal payroll rule engine from `HrSalaryRule`.
- **Do not** call STP/eSocial/CPF/SARS HTTP inside reducers.
- **Do not** broaden org-wide employee subscriptions with more PII.
- **Do not** conflate auth `/(auth)/onboarding` with HR employee onboarding.
- **Do not** spawn Wave B before Wave A gate.
- **Do not** put forms under `frontend/web/lib/*-form-configs.ts`.
- **Do not** commit unless the user explicitly asks.

## When user says "run the plan"

1. Read coordinator mission + tracker.
2. Report current wave + blocked tracks.
3. Spawn all eligible Wave A (or next incomplete wave) sub-agents with phase scope.
4. After return: run wave gate, summarize pass/fail, recommend next wave.
