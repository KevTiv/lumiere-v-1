# COV-00 evidence index

The audit uses current source and existing accepted evidence rather than historical plan claims alone.

## Primary COV-00 evidence

- [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md) — current route/module/operation census and U-level evidence floors.
- [`erp-cov00-correctness-evidence-defect-register.md`](./erp-cov00-correctness-evidence-defect-register.md) — source-level correctness/evidence defects and D/A/O/E proof model.
- [`erp-cov00c-correctness-census-status.md`](./erp-cov00c-correctness-census-status.md) and [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json) — current owned defect census, downstream gates, and source ratchets.
- [`erp-cov00-review-handoff.md`](./erp-cov00-review-handoff.md) — closure cards COV-00A through COV-00D.
- [`erp-module-usability-parity-cov00-status.md`](./erp-module-usability-parity-cov00-status.md) — current REVIEW status and blockers.
- [`erp-cov00-next-assignment-order.md`](./erp-cov00-next-assignment-order.md) — dependency/order guidance for follow-up agents.
- [`erp-cov00-findings.md`](./erp-cov00-findings.md) — concise headline findings.

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

## Correctness/effect evidence sampled

- `api-server/src/routes/operations.rs` and `api-server/src/commands.rs` — authenticated generated-operation/trusted-context authority is strong, but generic successful dispatch currently yields transport acceptance rather than authoritative business-effect disposition.
- `frontend/packages/query-hooks/src/hooks/ai-action-drafts.ts` — production newest/highest-id correlation after draft creation; must be replaced by stable request/effect identity.
- `frontend/web/tests/e2e/helpers-exact-sale-order.ts` — current opportunity→sale-order helper enforces exact 0..1 identity; other latest/highest helpers remain classified under COV-D09.
- `frontend/packages/ui/src/forms/form-modal.tsx` — missing-submit false success is repaired and guarded.
- `frontend/packages/ui/src/forms/runtime-form-modal.tsx` — runtime-config failure can fall back to static form and still submit.
- `frontend/packages/api-client/src/create-client.ts`, `frontend/packages/query-hooks/src/http.ts`, and `frontend/web/lib/server-query.ts` — `AllowEmpty` paths can collapse non-OK/failure into `[]`; COV-00C must classify critical usages.
- `frontend/packages/ui/src/lib/stored-dashboard-resolver.ts` — malformed domains can broaden to all rows; unknown operators can pass; missing timestamps/measures weaken period/aggregate semantics.
- `frontend/web/hooks/use-stored-dashboard-data-sources.ts` — renderer currently receives loading but not a shared source-error/partial-state contract.

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
- `frontend/web/tests/e2e/iot-lifecycle.spec.ts`
- `frontend/web/tests/e2e/proposals-lifecycle.spec.ts`
- `frontend/web/tests/e2e/phase-11-missing-modules-smoke.spec.ts`
- pre-tenant payment/communications/mobile/IR/agent adversarial specs

The matrix intentionally records an evidence floor when a spec relies on direct BFF/reducer helpers for principal lifecycle transitions; such a spec is not treated as proof that the same lifecycle is fully reachable through the operator UI.

## Accepted proof vocabulary

Primary lifecycle evidence is recorded independently:

```text
D  domain invariant
A  authenticated API / generated operation integration
O  actual operator/UI transition
E  exact effect identity + replay/lost-response recovery
```

Do not convert `D+A` into `O`, and do not convert a successful transport response into `E`.

Examples requiring explicit calibration:

- HR/payroll: meaningful D/A evidence; operator transitions and effect identity remain partial for principal paths.
- Projects: domain SoD evidence is stronger than current browser operator proof.
- IoT: lifecycle BFF proof is stronger than current operator-path proof.
- Proposals: conversion/lifecycle BFF proof is stronger than current operator-path proof.
- CRM→Sales: strict 0..1 `opportunity_id` correlation and replay proof are present; direct-navigation and complete stale/denied/lost-response UI evidence remain for COV-01/COV-00D review.

## COV-00 closure evidence still required

- COV-00A current operation/disposition artifact + unclassified-operation ratchet — integrated acceptance candidate.
- COV-00B first-org exposure manifest + Fleet route decision — integrated acceptance candidate.
- COV-00C complete defect ownership census + launch/downstream gates — integrated acceptance candidate.
- COV-00D module primary-lifecycle D/A/O/E matrix + corrected test/evidence claims.

COV-00 acceptance means the remaining work is truthfully owned and measurable. It does not mean the runtime defects themselves are already fixed; those stay blocking on their downstream U4/U5 and COV-27 gates.
