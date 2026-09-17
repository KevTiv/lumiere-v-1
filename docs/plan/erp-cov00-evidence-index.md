# COV-00 evidence index

The audit used current source and existing accepted evidence rather than historical plan claims alone.

## Product and contract authorities

- `docs/plans/erp-module-usability-parity-program.md`
- `docs/plan/erp-module-usability-parity-ledger.md`
- `docs/plan/erp-harness-base00-current-state-matrix.md`
- `docs/reducer-coverage-matrix.md`
- `docs/V1_ROADMAP.md`
- `docs/plans/sme-erp-feature-gap-plan.md`

## Current source surfaces inspected

- `frontend/web/app/(modules)/`
- `frontend/web/app/(modules)/modules-shell.tsx`
- `frontend/packages/query-hooks/src/hooks/`
- `frontend/packages/stdb/src/commands/`
- `frontend/packages/stdb/src/read-models/`
- `spacetimedb/src/`

## Representative browser evidence inspected

- `frontend/web/tests/e2e/module-smoke.spec.ts`
- `frontend/web/tests/e2e/mvp-lead-to-cash.spec.ts`
- `frontend/web/tests/e2e/mvp-procure-to-pay.spec.ts`
- `frontend/web/tests/e2e/mvp-sales-returns.spec.ts`
- `frontend/web/tests/e2e/accounting-post-reconcile.spec.ts`
- `frontend/web/tests/e2e/hr-wave-lifecycle.spec.ts`
- `frontend/web/tests/e2e/projects-wave-lifecycle.spec.ts`
- `frontend/web/tests/e2e/expenses-wave-lifecycle.spec.ts`
- `frontend/web/tests/e2e/subscriptions-wave-lifecycle.spec.ts`
- `frontend/web/tests/e2e/documents-wave-b-lifecycle.spec.ts`
- `frontend/web/tests/e2e/phase-11-missing-modules-smoke.spec.ts`
- pre-tenant payment/communications/mobile/IR/agent adversarial specs

The matrix intentionally records an evidence floor when a spec relies on direct BFF/reducer helpers for principal lifecycle transitions; such a spec is not treated as proof that the same lifecycle is fully reachable through the operator UI.
