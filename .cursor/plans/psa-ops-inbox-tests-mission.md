# [psa-ops-inbox-tests] Mission — live queues + domain + Playwright

**Handle:** `[psa-ops-inbox-tests]`  
**Wave:** A  
**Depends on:** `[psa-ui-contracts]` + `[psa-time-approval]` + `[psa-billing-integrity]` callable  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Add bounded live SQL queues for ops inboxes, restrict CSV timesheet import to Draft by default, and prove create→log→validate→bill with domain + Playwright tests.

**Exit criteria:** `timesheets-to-validate` and `timesheets-unbilled` in workspace/SQL; `run_all_projects_tests` (or equivalent) green locally; `projects-wave-lifecycle.spec.ts` covers happy path; CSV cannot silently import validated+billed.

## Why this exists

Investigation: full-table org SQL only; no projects domain tests; e2e is render-only; CSV can bypass workflow.

## Primary artifacts

| Artifact | Path |
|----------|------|
| ERP SQL | `frontend/packages/stdb/src/queries/erp-subscriptions.ts` |
| Workspace | `frontend/packages/stdb/src/subscriptions/projects-workspace.ts` |
| Query registry | `frontend/packages/stdb/src/generated/query-registry.ts` (regen) |
| Imports | `spacetimedb/src/data_ops/project_imports.rs` |
| Domain tests | `spacetimedb/tests/` (follow expenses/subscriptions pattern) |
| E2E | `frontend/web/tests/e2e/` |
| Smoke | `frontend/web/tests/e2e/phase-5-workforce-smoke.spec.ts` |

## Out of scope

- Margin / capacity live views (Waves C–D)
- Rate cards (Wave B)
- New billing math (owned by billing track)

---

## Phase 1 — Bounded subscriptions + CSV policy

### 1.1 SQL keys

Add org/company-scoped queries:

- `timesheets-to-validate` — `validation_status` draft (or submitted), not invoiced
- `timesheets-unbilled` — validated + billable + `timesheet_invoice_id` null

Wire into `PROJECTS_WORKSPACE_RESOURCE_KEYS`, `ERP_ORG_SQL`, module subscription hooks.

### 1.2 CSV

Default `import_timesheet_csv` to force `validation_status=draft`, clear invoice id; privileged break-glass only if pattern exists elsewhere.

### Verify Phase 1

```bash
rg 'timesheets-to-validate|timesheets-unbilled' frontend/packages/stdb/src/
rg 'validation_status.*draft|Draft-only|draft only' spacetimedb/src/data_ops/project_imports.rs
cd frontend/web && pnpm exec tsc --noEmit 2>&1 | tail -5
```

### Success criteria

- [x] Two bounded keys subscribed from projects module
- [x] CSV draft-default enforced
- [x] Typecheck OK (`cargo check` module; web tsc has pre-existing sales/inventory noise)

---

## Phase 2 — Domain suite + Playwright

### 2.1 Domain tests

Add `spacetimedb/tests/projects/` (mirror expenses waves):

- Company isolation: B cannot validate/bill A
- SoD: logger cannot validate
- Freeze: cannot stop timer / mutate validated
- Bill: uses sell rate; sets `timesheet_invoice_id`; second bill fails
- Period lock: closed period rejects (if test harness can set period)

Wire `run_all_projects_tests` reducer or test entry like other domains.

### 2.2 Playwright

`frontend/web/tests/e2e/projects-wave-lifecycle.spec.ts`:

1. Create project (valid bill type)
2. Create task
3. Log timesheet (required fields)
4. Validate as different user if harness allows; else document permission fixture
5. Bill timesheets → assert invoice / timesheet link in UI or query

Keep workforce smoke as render regression.

### Verify Phase 2

```bash
rg 'run_all_projects_tests|run_projects' spacetimedb/ --glob '*.rs' | head -15
test -f frontend/web/tests/e2e/projects-wave-lifecycle.spec.ts && echo OK
# Prefer: spacetime call … run_all_projects_tests (when published)
cargo test --manifest-path spacetimedb/Cargo.toml projects 2>&1 | tail -20
```

### Success criteria

- [x] Domain suite exists and covers isolation + bill link
- [x] Playwright lifecycle spec exists
- [x] Tracker Wave A test checkboxes marked (runtime `spacetime call … run_all_projects_tests` + Playwright still on ops checklist after publish)
