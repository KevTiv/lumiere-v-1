---
name: erp-v1-coordinator
description: >-
  Coordinate parallel Cursor sub-agents to execute the Lumiere V1 production
  roadmap: Wave 1 auth/lead-to-cash/params/ops, Wave 2 returns/3-way-match/
  accounting-close, Wave 3 import-wizard/ai-guardrails. Use when the user asks
  to run the V1 plan, V1 coordinator, production roadmap waves, or spawn V1
  sub-agents.
---

# ERP V1 Coordinator

You are the **coordinator agent** for Lumiere **V1 production readiness**. Do not implement all tracks yourself — delegate to sub-agents via the **Task** tool, enforce wave dependency order, and verify exit criteria before closing a wave.

## Source of truth

| Doc | Role |
|-----|------|
| [docs/V1_ROADMAP.md](../../docs/V1_ROADMAP.md) | Product frame, wedges, validation corrections, wave order, V1 definition |
| Track index + mission under `.cursor/plans/` | Executable handoff per sub-agent |
| [docs/MVP_WORKFLOW_CONTRACT.md](../../docs/MVP_WORKFLOW_CONTRACT.md) | Golden-path E2E steps |
| [docs/MVP_PARAMS_COHESION_AUDIT.md](../../docs/MVP_PARAMS_COHESION_AUDIT.md) | Params mapper ledger |

Search handle tags with `rg '\[auth-hardening\]' .cursor` (and sibling handles).

## Coordinator workflow

### 1. Orient (always)

1. Read [docs/V1_ROADMAP.md](../../docs/V1_ROADMAP.md) — current wave and validation snapshot.
2. Skim each active track mission's **Success criteria** and **Out of scope**.
3. Run quick status probes (coordinator only — do not deep-implement):

```bash
# Auth — server-token fallback still present?
rg 'if token.is_none\(\)' api-server/src/session.rs
rg 'stdb_server_token.*token = Some' api-server/src/session.rs

# Params casts
rg 'as unknown as Create' frontend/web/app/\(modules\)/ --glob '*.tsx' | wc -l

# Golden path
rg 'step 7.*manual|step 7.*proven' docs/MVP_WORKFLOW_CONTRACT.md

# E2E availability
make -n e2e-mvp-golden 2>&1 | head -3
```

### 2. Plan waves (dependency order)

```
Wave 1 (parallel — no cross-track blockers)
├── [auth-hardening] Phase 1–2 — session hardening (blocks safe pilot)
├── [lead-to-cash-gaps] Phase 1–3 — SO line E2E, delivery exceptions, invoice correction
├── [params-cohesion-v2] Phase 1–2 — cast removal + money/stock mappers
└── [prod-ops] Phase 1–2 — metrics + backup/export docs

Wave 2 (after Wave 1 gate)
├── [sales-returns-rma] Phase 1–4 — greenfield RMA domain + UI + E2E
├── [purchasing-3way-match] Phase 1–3 — match view + bill guard + P2P E2E
└── [accounting-close] Phase 1–4 — GL drilldown, close checklist, fiscal lock, VAT polish

Wave 3 (after Wave 2 gate)
├── [import-wizard-v1] Phase 1–4 — templates, editor, entity expansion, duplicates
└── [ai-guardrails] Phase 1–3 — allowlist, diff preview, execution audit

Post-V1 (Phase 4 backlog — do not spawn unless user expands scope)
└── CRM duplicate detection, manufacturing tier-3 sweep, 85%+ mapper coverage, SSO
```

**Hard dependencies:**

- `[sales-returns-rma]` backend (Phase 1) before frontend/E2E phases.
- `[params-cohesion-v2]` Phase 3 script before Phase 4 CI gate.
- `[auth-hardening]` Phase 1 before treating any E2E as security proof.
- Do **not** spawn `[import-wizard-v1]` entity expansion before auth hardening merges (import route is session-scoped).

### 3. Spawn sub-agents

Use **Task** with `subagent_type: generalPurpose`. One sub-agent per track per phase batch. Pass the full track mission path and explicit phase scope.

**Sub-agent prompt template:**

```
You are executing track [HANDLE] for the Lumiere ERP V1 production roadmap.

Read and follow ONLY:
- .cursor/plans/<track>-mission.md — Phase N (<phase name>)
- docs/V1_ROADMAP.md — wedge context (build vs verify)

Rules:
- SpacetimeDB reducers: follow .cursor/rules/lumiere-reducer-conventions.mdc
- Frontend forms: FormConfig in frontend/packages/ui/src/lib/*-form-configs.ts
  (NOT frontend/web/lib/) + FormModal + ModularForm
- Mappers: frontend/web/lib/*-create-params.ts or erp-shared; stdbParamsToJson(..., "StructName")
- Smallest correct diff; do not expand scope beyond mission Out of scope
- After backend reducer/table changes: spacetime generate + fix TypeScript bindings
- Run verification commands listed in mission Phase N before finishing

Return:
1. Files changed (paths)
2. Verification command outputs (pass/fail)
3. Blockers for next phase
4. Whether success criteria for this phase are met (checklist)
```

**Parallelism:** Launch Wave 1 tracks in a **single message** with multiple Task calls.

### 4. Integrate & gate

After sub-agents return:

1. **Conflict check** — same file edited by two tracks → reconcile or re-serialize.
2. **Bindings** — if any `spacetimedb/src/**/*.rs` reducer changed, ensure `spacetime generate` ran and TS compiles.
3. **Wave gate** — run commands below for the completed wave.
4. Update track mission checkboxes if the user wants persistent tracking.

Do **not** mark V1 complete until [docs/V1_ROADMAP.md](../../docs/V1_ROADMAP.md) § Final V1 definition is satisfied.

### 5. Wave gate commands

#### Wave 1 gate

```bash
# Auth — no anonymous admin token path
rg 'stdb_server_token.*token = Some' api-server/src/session.rs && echo FAIL || echo OK

curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:8082/v1/query/contacts?organizationId=1"
# Expect: 401 (api-server running, no cookies)

# Params — casts removed from module clients
rg 'as unknown as Create' frontend/web/app/\(modules\)/ --glob '*.tsx' && echo FAIL || echo OK

# Ops — metrics increment (manual: hit /health then check /metrics)
rg 'inc_request|inc_error' api-server/src/http_app.rs

# Golden path
E2E_CLEAR_DB=1 make e2e-mvp-golden

cd frontend/web && pnpm exec tsc --noEmit 2>&1 | tail -5
```

#### Wave 2 gate

```bash
# Returns domain exists
rg 'return_order|ReturnOrder' spacetimedb/src/sales/

# 3-way match UI
rg 'qty_received|qty_invoiced|match' frontend/web/app/\(modules\)/purchasing/purchasing-client.tsx

# GL drilldown
rg 'drill|selectedAccount|accountId' frontend/packages/ui/src/accounting-components/general-ledger-view.tsx

# Fiscal lock on post_payment
rg 'ensure_accounting_period_open' spacetimedb/src/accounting/payments.rs

# E2E
cd frontend/web && pnpm exec playwright test tests/e2e/mvp-procure-to-pay.spec.ts tests/e2e/mvp-sales-returns.spec.ts 2>/dev/null || true

cargo test --manifest-path spacetimedb/Cargo.toml return 2>&1 | tail -5
```

#### Wave 3 gate

```bash
# Import templates wired
rg 'save_import_mapping_template|ImportMappingTemplate' frontend/web/lib/guided-import-wizard.tsx

# AI diff preview
rg 'diff|preview' frontend/web/app/\(modules\)/ai-action-drafts/ 2>/dev/null || \
  rg 'diff|preview' frontend/web/app/\(modules\)/ai/ 2>/dev/null

# AI specs still green
cd frontend/web && pnpm exec playwright test tests/e2e/mvp-ai-action-draft.spec.ts

# Params CI script (if Wave 1 track completed Phase 3–4)
test -f scripts/check-params-mapper-coverage.ts && node scripts/check-params-mapper-coverage.ts --min-coverage 55
```

## Sub-agent track handles

| Handle | Mission file | Wave | Owner focus |
|--------|--------------|------|-------------|
| `[auth-hardening]` | `auth-hardening-mission.md` | 1 | Remove server-token fallback; permission E2E |
| `[lead-to-cash-gaps]` | `lead-to-cash-gaps-mission.md` | 1 | SO line E2E, delivery exceptions, invoice correction |
| `[params-cohesion-v2]` | `params-cohesion-v2-mission.md` | 1 | Cast removal, mappers, coverage CI |
| `[prod-ops]` | `prod-ops-mission.md` | 1 | Metrics, backup docs, staging, CI verify |
| `[sales-returns-rma]` | `sales-returns-rma-mission.md` | 2 | Return order domain + credit note flow |
| `[purchasing-3way-match]` | `purchasing-3way-match-mission.md` | 2 | PO match view + bill post guard |
| `[accounting-close]` | `accounting-close-mission.md` | 2 | GL drilldown, period close, fiscal lock |
| `[import-wizard-v1]` | `import-wizard-v1-mission.md` | 3 | Templates, editor, entity expansion |
| `[ai-guardrails]` | `ai-guardrails-mission.md` | 3 | Allowlist, diff preview, execution audit |

## Coordinator anti-patterns

- **Do not** greenfield bank recon / fixed assets — validation confirmed they exist; verify only.
- **Do not** spawn Wave 2 RMA frontend before Wave 2 backend Phase 1 merges.
- **Do not** skip `spacetime generate` after reducer/table changes.
- **Do not** add forms under `frontend/web/lib/*-form-configs.ts` — use `frontend/packages/ui/src/lib/`.
- **Do not** treat E2E as security proof while `[auth-hardening]` Phase 1 is open.
- **Do not** batch Wave 1 + Wave 2 in one sub-agent — keep waves serial.
- **Do not** commit unless the user explicitly asks.

## When user says "run the plan"

1. Read [docs/V1_ROADMAP.md](../../docs/V1_ROADMAP.md) and determine lowest incomplete **wave**.
2. Report current wave + which tracks are blocked or partially done (use orient probes).
3. Spawn all Wave 1 sub-agents (or next incomplete wave) with phase scope from mission files.
4. After return: run wave gate commands, summarize pass/fail, recommend next wave.
5. If Wave 3 gate passes, confirm V1 definition checklist in roadmap § Final V1 definition.

## Related

- [erp-mvp-coordinator/SKILL.md](../erp-mvp-coordinator/SKILL.md) — predecessor (M4/M5 CRM/audit/tests)
- [.cursor/plans/README.md](../../plans/README.md) — mission index tables
