# COV-01b reference action card — CRM opportunity → Sales order

Base: COV prototype branch stacked on COV-00 review branch  
Target: prove the canonical operation/effect/readback seam on one cross-module action before broad adoption.

## Current concrete path

```text
CRM opportunity row / Convert to sale order
→ crm-client.tsx workflow modal
→ useConvertOpportunityToSaleOrder
→ stdbBffCommandPost("convert_opportunity_to_sale_order")
→ generated contract operation id
→ POST /api/operations/:operation
→ TrustedOperationContext
→ convert_opportunity_to_sale_order reducer
→ { ok: true }
→ invalidate opportunities + sale-orders
→ caller/test separately searches sale-orders
```

## Canonical effect contract

```text
source: Opportunity.id
result: SaleOrder
stable relation: SaleOrder.opportunity_id == Opportunity.id
cardinality: 0..1
```

Behavior:

- 0 before dispatch → operation may be dispatched once.
- 1 before dispatch → `AlreadyApplied(ref)`, no dispatch.
- >1 before or after dispatch → invariant failure; do not choose newest.
- successful dispatch + 1 after → `Applied(ref)`.
- dispatch ambiguity or bounded post-read with 0 → `OutcomeUnknown`; do not resend automatically.

## Follow-up implementation files

Expected bounded ownership, subject to coordinator review:

```text
frontend/packages/query-hooks/src/hooks/crm.ts
frontend/web/app/(modules)/crm/crm-client.tsx
frontend/web/tests/e2e/helpers.ts
frontend/web/tests/e2e/mvp-lead-to-cash.spec.ts
```

Shared prototype files remain coordinator-owned:

```text
frontend/packages/api-client/src/operation-outcome.ts
frontend/packages/query-hooks/src/hooks/operation-effect.ts
```

## Required proof

- exact query resolver by `opportunity_id`;
- duplicate match test fails;
- idempotent replay does not dispatch or create another order;
- generated operation input remains unchanged;
- typed rejection/conflict reaches caller;
- ambiguous result stays unknown and never auto-retries;
- UI obtains resulting sale-order ref and can navigate directly;
- browser refresh in Sales shows the same canonical order;
- existing STDB idempotency/domain tests remain green;
- lead-to-cash E2E removes newest-row and partner-only fallback for this result.

## Out of scope

- generic migration of every CRM mutation;
- new reducer return-value infrastructure;
- global error taxonomy redesign;
- Sales/inventory/invoicing workflow changes;
- contract release unless exact relation metadata is proven missing from accepted query contracts.
