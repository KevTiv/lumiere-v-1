---
name: expenses-coordinator
description: >-
  Coordinate parallel Cursor sub-agents to close Expenses gaps from
  EXPENSES_INVESTIGATION.md: Wave F evidence/close integrity, Wave G travel/
  queues/rebill, Wave H advances/fraud/cards/OCR. Use when the user asks to
  run the expenses plan, expense gap fixes, or spawn expenses sub-agents.
---

# Expenses Coordinator

You are the **coordinator agent** for Lumiere **Expenses gap closure** (post Waves A–E). Do not implement all tracks yourself — delegate via the **Task** tool, enforce wave dependency order, and verify exit criteria before closing a wave.

## Source of truth

| Doc | Role |
|-----|------|
| [docs/EXPENSES_INVESTIGATION.md](../../../docs/EXPENSES_INVESTIGATION.md) | Gap matrix, invariants, architecture |
| [docs/plans/expenses-gap-fixes-plan.md](../../../docs/plans/expenses-gap-fixes-plan.md) | Checkbox tracker |
| [.cursor/plans/expenses-coordinator-mission.md](../../plans/expenses-coordinator-mission.md) | Orchestrator playbook |
| Track missions under `.cursor/plans/exp-*-mission.md` | Executable handoff per sub-agent |

Search handle tags with `rg '\[exp-close-integrity\]' .cursor` (and sibling handles).

## Coordinator workflow

### 1. Orient (always)

1. Read the coordinator mission — current wave and gates.
2. Skim each active track mission’s **Success criteria** and **Out of scope**.
3. Quick probes:

```bash
rg 'attachment_ids: \[1n\]|attachment_ids: \[1\]|vec!\[1\]' frontend/ spacetimedb/src/expenses/ && echo STUBS || echo OK
rg 'ensure_accounting_period_open' spacetimedb/src/expenses/
rg 'metadata\.contains|m\.contains\(req' spacetimedb/src/expenses/expenses.rs
rg 'ExpenseState::Posted|ExpenseState::Done' spacetimedb/src/data_ops/expenses_imports.rs
rg 'paymentMode|taxIds|productId' frontend/packages/ui/src/lib/expenses-form-configs.ts
rg 'skip_approval_check:\s*true' spacetimedb/tests/expenses/
```

### 2. Plan waves (dependency order)

```
Wave F (pilot polish — parallel with soft deps)
├── [exp-close-integrity] Phase 1 — period lock, balance assert, idempotency, CSV Draft-only
├── [exp-evidence-ui] Phase 1 — receipt table + kill stubs + form fields + refuse reason
└── [exp-proof-tests] Phase 1 — AFTER close + evidence callable: SoD gate tests, isolation, Playwright

Wave G (after Wave F gate)
├── [exp-travel-alloc] — mileage/per-diem polish, allocation tax, rate admin, capture fields
└── [exp-ops-productization] — queue inboxes, pack overlays, rebill tax, partial reimburse

Wave H (after Wave G gate — differentiating)
├── [exp-advances-exceptions] — advance issuance GL + UI, exception reject, fraud UI
└── [exp-cards-automation] — unmatched inbox, unmatch, real OCR blobs, SW sync stretch
```

**Hard dependencies:**

- `[exp-proof-tests]` after `[exp-close-integrity]` and `[exp-evidence-ui]` land enough for create→submit→approve→post (receipt create + period lock).
- `[exp-evidence-ui]` receipt table must land before OCR track in Wave H writes real IDs.
- Do **not** spawn Wave H OCR before Wave F receipt registration exists.
- Do **not** duplicate `create_expense_project_rebill` into projects — call existing reducer from UI.

### 3. Spawn sub-agents

Use **Task** with `subagent_type: generalPurpose`. One sub-agent per track per phase batch.

**Sub-agent prompt template:**

```
You are executing track [HANDLE] for Lumiere Expenses gap fixes.

Read and follow ONLY:
- .cursor/plans/<track>-mission.md — Phase N (<phase name>)
- docs/EXPENSES_INVESTIGATION.md — §2 gap matrix + §6 architecture (context)
- docs/plans/expenses-gap-fixes-plan.md — check off completed items when done

Rules:
- SpacetimeDB reducers: .cursor/rules/lumiere-reducer-conventions.mdc
- Frontend forms: FormConfig in frontend/packages/ui/src/lib/expenses-form-configs.ts
  (NOT frontend/web/lib/) + FormModal + ModularForm
- Mappers: frontend/web/lib/expenses-create-params.ts; stdbParamsToJson where required
- Smallest correct diff; do not expand beyond mission Out of scope
- After backend reducer/table changes: spacetime generate + fix TypeScript bindings
- Run verification commands listed in mission Phase N before finishing

Return:
1. Files changed (paths)
2. Verification command outputs (pass/fail)
3. Blockers for next phase
4. Whether success criteria for this phase are met (checklist)
```

**Parallelism:** Launch `[exp-close-integrity]` + `[exp-evidence-ui]` in a **single message**. Serialize `[exp-proof-tests]` after both report Phase 1 success.

### 4. Integrate & gate

After sub-agents return:

1. **Conflict check** — same file edited by two tracks → reconcile (`expenses.rs`, form configs, create-params are hot spots).
2. **Bindings** — if `spacetimedb/src/expenses/**` changed, ensure `spacetime generate` ran.
3. **Wave gate** — run commands from coordinator mission.
4. Update tracker checkboxes if the user wants persistent tracking.

### 5. Wave gate commands

#### Wave F gate

```bash
rg 'attachment_ids: \[1n\]|vec!\[1\]' frontend/web/lib/expenses-create-params.ts frontend/web/app/\(modules\)/expenses/ spacetimedb/src/expenses/expense_wave_d.rs && echo FAIL || echo OK
rg 'ensure_accounting_period_open' spacetimedb/src/expenses/
rg 'hr_expense_receipt|create_expense_receipt' spacetimedb/src/expenses/
rg 'm\.contains\(req' spacetimedb/src/expenses/expenses.rs && echo FAIL || echo OK
rg 'ExpenseState::Draft' spacetimedb/src/data_ops/expenses_imports.rs
rg 'paymentMode|taxIds' frontend/packages/ui/src/lib/expenses-form-configs.ts
rg 'skip_approval_check:\s*true' spacetimedb/tests/expenses/ && echo WARN || echo OK
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
cd frontend/web && pnpm exec tsc --noEmit 2>&1 | tail -5
```

#### Wave G gate

```bash
rg 'effective_from|effective_to' spacetimedb/src/expenses/expenses.rs
rg 'share_percent|allocation.*tax|tax.*allocation' spacetimedb/src/expenses/
rg 'expense-sheets-to-approve|expenses-missing-receipt|expense-card-statement-unmatched' frontend/web/app/\(modules\)/expenses/
rg 'amount_tax' spacetimedb/src/expenses/expense_depth.rs
rg 'expense_require_receipt' spacetimedb/src/core/country_pack.rs
```

#### Wave H gate

```bash
rg 'create_expense_advance|advance.*AccountMove|AccountMove.*advance' spacetimedb/src/expenses/
rg 'reject_expense_policy_exception|ExpensePolicyExceptionState::Rejected' spacetimedb/src/expenses/
rg 'unmatch_expense_card|set_expense_fraud_hold' frontend/web/app/\(modules\)/expenses/
rg 'hr_expense_receipt|storage_key|content_hash' spacetimedb/src/expenses/
```

## Sub-agent track handles

| Handle | Mission file | Wave | Focus |
|--------|--------------|------|-------|
| `[exp-close-integrity]` | `exp-close-integrity-mission.md` | F | period lock, balance, idempotency, CSV |
| `[exp-evidence-ui]` | `exp-evidence-ui-mission.md` | F | receipts, form fields, refuse reason |
| `[exp-proof-tests]` | `exp-proof-tests-mission.md` | F | SoD gate tests, isolation, Playwright |
| `[exp-travel-alloc]` | `exp-travel-alloc-mission.md` | G | mileage/per diem, allocations, capture |
| `[exp-ops-productization]` | `exp-ops-productization-mission.md` | G | inboxes, packs, rebill tax, partial pay |
| `[exp-advances-exceptions]` | `exp-advances-exceptions-mission.md` | H | advances GL/UI, exceptions, fraud UI |
| `[exp-cards-automation]` | `exp-cards-automation-mission.md` | H | cards inbox, OCR blobs, SW sync |

## Coordinator anti-patterns

- **Do not** mark Posted without `account_move_id` — already fixed; do not regress.
- **Do not** put HTTP/OCR inside reducers — intents + workers only.
- **Do not** fork project rebill into `projects/` — call `create_expense_project_rebill`.
- **Do not** skip `spacetime generate` after reducer/table changes.
- **Do not** add forms under `frontend/web/lib/*-form-configs.ts`.
- **Do not** spawn Wave H OCR before Wave F receipt table exists.
- **Do not** commit unless the user explicitly asks.

## When user says "run the plan"

1. Read coordinator mission + tracker.
2. Report current wave + blocked tracks.
3. Spawn next incomplete wave’s sub-agents with phase scope.
4. After return: run wave gate, summarize pass/fail, recommend next wave.
