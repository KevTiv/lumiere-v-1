# Plan clusters (agent handoff)

Multi-session work is described by **handle-tagged** markdown clusters here, plus the meta guide at [.cursor/plan-construction.md](../plan-construction.md).

## Form builder (required for pending UI)

Any **new or unfinished** module UI that collects structured input (create/edit, multi-field modals) **must** use **`FormConfig`** + **`FormModal`** + **`ModularForm`**, with **`mergeFieldDefaultValues`** / **`mergeSelectOptionsByFieldName`** as needed. See root plans (e.g. `ERP_FRONTEND_PLAN.md`, `FORM_CONFIGURATION_REMAINING_WORK.md`) and [.cursor/plan-construction.md](../plan-construction.md). Avoid ad-hoc `Dialog` + raw inputs for CRUD unless a mission explicitly exempts that screen.

## ERP MVP coordinator (parallel tracks — M4/M5)

Multi-track execution for CRM lifecycle, dashboard polish, audit compliance, and domain tests. Start with the **coordinator skill** or orchestrator mission.

| Handle | Index | Mission | Milestone |
|--------|--------|---------|-----------|
| `[erp-mvp-coordinator]` | [erp-mvp-coordinator.md](./erp-mvp-coordinator.md) | [erp-mvp-coordinator-mission.md](./erp-mvp-coordinator-mission.md) | Orchestrator |
| `[crm-opportunity-lifecycle]` | [crm-opportunity-lifecycle.md](./crm-opportunity-lifecycle.md) | [crm-opportunity-lifecycle-mission.md](./crm-opportunity-lifecycle-mission.md) | M4 |
| `[dashboard-charts-live]` | [dashboard-charts-live.md](./dashboard-charts-live.md) | [dashboard-charts-live-mission.md](./dashboard-charts-live-mission.md) | M4 |
| `[audit-log-gaps]` | [audit-log-gaps.md](./audit-log-gaps.md) | [audit-log-gaps-mission.md](./audit-log-gaps-mission.md) | M5 |
| `[domain-tests-harness]` | [domain-tests-harness.md](./domain-tests-harness.md) | [domain-tests-harness-mission.md](./domain-tests-harness-mission.md) | M5 |

**Skill:** [.cursor/skills/erp-mvp-coordinator/SKILL.md](../skills/erp-mvp-coordinator/SKILL.md) — spawn sub-agents, wave gates, dependency order.

**Run:** *"Run the ERP MVP coordinator — Wave 1"* or *"Coordinate sub-agents for `[audit-log-gaps]` Phase 1"*.

## V1 production coordinator (parallel tracks — pilot readiness)

Multi-track execution for auth hardening, lead-to-cash gaps, params cohesion Phase B/C, prod ops, returns/RMA, 3-way match, accounting close, import wizard, and AI guardrails. Start with the **V1 coordinator skill** and [docs/V1_ROADMAP.md](../../docs/V1_ROADMAP.md).

| Handle | Index | Mission | Wave |
|--------|--------|---------|------|
| `[auth-hardening]` | [auth-hardening.md](./auth-hardening.md) | [auth-hardening-mission.md](./auth-hardening-mission.md) | 1 |
| `[lead-to-cash-gaps]` | [lead-to-cash-gaps.md](./lead-to-cash-gaps.md) | [lead-to-cash-gaps-mission.md](./lead-to-cash-gaps-mission.md) | 1 |
| `[params-cohesion-v2]` | [params-cohesion-v2.md](./params-cohesion-v2.md) | [params-cohesion-v2-mission.md](./params-cohesion-v2-mission.md) | 1 |
| `[prod-ops]` | [prod-ops.md](./prod-ops.md) | [prod-ops-mission.md](./prod-ops-mission.md) | 1 |
| `[sales-returns-rma]` | [sales-returns-rma.md](./sales-returns-rma.md) | [sales-returns-rma-mission.md](./sales-returns-rma-mission.md) | 2 |
| `[purchasing-3way-match]` | [purchasing-3way-match.md](./purchasing-3way-match.md) | [purchasing-3way-match-mission.md](./purchasing-3way-match-mission.md) | 2 |
| `[accounting-close]` | [accounting-close.md](./accounting-close.md) | [accounting-close-mission.md](./accounting-close-mission.md) | 2 |
| `[import-wizard-v1]` | [import-wizard-v1.md](./import-wizard-v1.md) | [import-wizard-v1-mission.md](./import-wizard-v1-mission.md) | 3 |
| `[ai-guardrails]` | [ai-guardrails.md](./ai-guardrails.md) | [ai-guardrails-mission.md](./ai-guardrails-mission.md) | 3 |

**Skill:** [.cursor/skills/erp-v1-coordinator/SKILL.md](../skills/erp-v1-coordinator/SKILL.md) — spawn sub-agents, wave gates, dependency order.

**Roadmap:** [docs/V1_ROADMAP.md](../../docs/V1_ROADMAP.md) — wedges A–E, validation corrections, V1 definition.

**Run:** *"Run the V1 coordinator — Wave 1"* or *"Coordinate sub-agents for `[params-cohesion-v2]` Phase 1"*.

## Projects / PSA gap fixes (parallel tracks)

Multi-track execution for Projects & Professional Services Automation gaps from the investigation. Start with the **PSA coordinator skill** and tracker.

| Handle | Mission | Wave |
|--------|---------|------|
| `[projects-psa-coordinator]` | [projects-psa-coordinator-mission.md](./projects-psa-coordinator-mission.md) | Orchestrator |
| `[psa-ui-contracts]` | [psa-ui-contracts-mission.md](./psa-ui-contracts-mission.md) | A |
| `[psa-time-approval]` | [psa-time-approval-mission.md](./psa-time-approval-mission.md) | A |
| `[psa-billing-integrity]` | [psa-billing-integrity-mission.md](./psa-billing-integrity-mission.md) | A |
| `[psa-ops-inbox-tests]` | [psa-ops-inbox-tests-mission.md](./psa-ops-inbox-tests-mission.md) | A |
| `[psa-rates-productization]` | [psa-rates-productization-mission.md](./psa-rates-productization-mission.md) | B |
| `[psa-capacity-delivery]` | [psa-capacity-delivery-mission.md](./psa-capacity-delivery-mission.md) | C |
| `[psa-project-accounting]` | [psa-project-accounting-mission.md](./psa-project-accounting-mission.md) | D |
| `[psa-advanced]` | [psa-advanced-mission.md](./psa-advanced-mission.md) | E |

**Skill:** [.cursor/skills/projects-psa-coordinator/SKILL.md](../skills/projects-psa-coordinator/SKILL.md)  
**Investigation:** [docs/PROJECTS_PSA_INVESTIGATION.md](../../docs/PROJECTS_PSA_INVESTIGATION.md)  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

**Run:** *"Run the PSA coordinator — Wave A"* or *"Coordinate sub-agents for `[psa-ui-contracts]` Phase 1"*.

## Expenses gap fixes (parallel tracks — post A–E)

Multi-track execution for remaining Expenses gaps from the investigation (Wave F evidence/close → G productization → H advances/cards/OCR). Start with the **expenses coordinator skill** and tracker.

| Handle | Mission | Wave |
|--------|---------|------|
| `[expenses-coordinator]` | [expenses-coordinator-mission.md](./expenses-coordinator-mission.md) | Orchestrator |
| `[exp-close-integrity]` | [exp-close-integrity-mission.md](./exp-close-integrity-mission.md) | F |
| `[exp-evidence-ui]` | [exp-evidence-ui-mission.md](./exp-evidence-ui-mission.md) | F |
| `[exp-proof-tests]` | [exp-proof-tests-mission.md](./exp-proof-tests-mission.md) | F |
| `[exp-travel-alloc]` | [exp-travel-alloc-mission.md](./exp-travel-alloc-mission.md) | G |
| `[exp-ops-productization]` | [exp-ops-productization-mission.md](./exp-ops-productization-mission.md) | G |
| `[exp-advances-exceptions]` | [exp-advances-exceptions-mission.md](./exp-advances-exceptions-mission.md) | H |
| `[exp-cards-automation]` | [exp-cards-automation-mission.md](./exp-cards-automation-mission.md) | H |

**Skill:** [.cursor/skills/expenses-coordinator/SKILL.md](../skills/expenses-coordinator/SKILL.md)  
**Investigation:** [docs/EXPENSES_INVESTIGATION.md](../../docs/EXPENSES_INVESTIGATION.md)  
**Tracker:** [docs/plans/expenses-gap-fixes-plan.md](../../docs/plans/expenses-gap-fixes-plan.md)

**Run:** *"Run the expenses coordinator — Wave F"* or *"Coordinate sub-agents for `[exp-close-integrity]` Phase 1"*.

## Coverage pipeline (do this first)

| Handle | Index | Mission |
|--------|--------|---------|
| `[reducer-coverage]` | [reducer-coverage.md](./reducer-coverage.md) | [reducer-coverage-mission.md](./reducer-coverage-mission.md) |

Regenerates `frontend/web/reducer-coverage-report.json` and validates detection before trusting module missions below.

## Module / theme — reducer → UI missions

| Handle | Index | Mission | Notes |
|--------|--------|---------|-------|
| `[reducer-ui-accounting]` | [reducer-ui-accounting.md](./reducer-ui-accounting.md) | [reducer-ui-accounting-mission.md](./reducer-ui-accounting-mission.md) | Consolidation, intercompany, tax, budget, … |
| `[reducer-ui-inventory]` | [reducer-ui-inventory.md](./reducer-ui-inventory.md) | [reducer-ui-inventory-mission.md](./reducer-ui-inventory-mission.md) | Quality, quants, traceability, … |
| `[reducer-ui-reports]` | [reducer-ui-reports.md](./reducer-ui-reports.md) | [reducer-ui-reports-mission.md](./reducer-ui-reports-mission.md) | Dashboards & widgets |
| `[reducer-ui-iot]` | [reducer-ui-iot.md](./reducer-ui-iot.md) | [reducer-ui-iot-mission.md](./reducer-ui-iot-mission.md) | Hub pairing, telemetry, device links |
| `[reducer-ui-documents]` | [reducer-ui-documents.md](./reducer-ui-documents.md) | [reducer-ui-documents-mission.md](./reducer-ui-documents-mission.md) | Processing jobs, knowledge CSV |
| `[reducer-ui-ai]` | [reducer-ui-ai.md](./reducer-ui-ai.md) | [reducer-ui-ai-mission.md](./reducer-ui-ai-mission.md) | Agents, insights — confirm product scope |
| `[reducer-ui-settings-auth]` | [reducer-ui-settings-auth.md](./reducer-ui-settings-auth.md) | [reducer-ui-settings-auth-mission.md](./reducer-ui-settings-auth-mission.md) | Roles, invites, sessions — security review |
| `[reducer-ui-integrations]` | [reducer-ui-integrations.md](./reducer-ui-integrations.md) | [reducer-ui-integrations-mission.md](./reducer-ui-integrations-mission.md) | Drive, WhatsApp |
| `[reducer-ui-data-imports]` | [reducer-ui-data-imports.md](./reducer-ui-data-imports.md) | [reducer-ui-data-imports-mission.md](./reducer-ui-data-imports-mission.md) | Central CSV epic + per-module pattern |
| `[reducer-ui-manufacturing]` | [reducer-ui-manufacturing.md](./reducer-ui-manufacturing.md) | [reducer-ui-manufacturing-mission.md](./reducer-ui-manufacturing-mission.md) | `link_device_to_workcenter` |

**Encoded in `track-reducer-coverage.ts` (no separate mission):** platform bucket / `EXPLICIT_REDUCER_MODULE` + `PLATFORM_TRIAGE_EXCLUDED_FROM_PRODUCT` — see [reducer-coverage-triage-reference.md](./reducer-coverage-triage-reference.md).

## Modules without a dedicated mission (typical)

Many modules show **100%** product coverage after a regen; remaining gaps are often **settings**, **uncategorized**, **imports** CSV, or cross-cutting missions above. See [reducer-coverage-triage-reference.md](./reducer-coverage-triage-reference.md) for the latest table.

## Intentionally no UI mission

- **`bootstrap`**, **`internal`** queue workers — dev/ops; not module UX. Track only if building admin tools.

## Authoring a new cluster

1. Read [.cursor/plan-construction.md](../plan-construction.md).
2. Copy [.cursor/templates/plan-mission-template.md](../templates/plan-mission-template.md) to `plans/{topic}-mission.md`.
3. Add `plans/{topic}.md` index linking the mission.
4. Add a row to the tables above.

## Cursor-generated plans

Ad-hoc `*.plan.md` files may appear here; optional. Prefer mission files for durable handoff.
