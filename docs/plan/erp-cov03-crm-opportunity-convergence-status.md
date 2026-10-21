# COV-03 CRM opportunity convergence

**Package:** `COV-03`
**Disposition:** `ACCEPTED` — bounded opportunity-to-sale-order slice only
**Base:** `61eb6ba259d02691152a422a5c11844cf73c4846`
**Operator proof:** [`../../frontend/web/tests/e2e/cov01d-opportunity-order-effect.spec.ts`](../../frontend/web/tests/e2e/cov01d-opportunity-order-effect.spec.ts)

## Accepted path

```text
sales-crm operator
→ CRM lead and opportunity forms
→ Convert to sale order action
→ erp.convert_opportunity_to_sale_order
→ convert_opportunity_to_sale_order reducer
→ SaleOrder.organization_id + company_id + opportunity_id exact readback
→ converged order reference
```

The slice reuses the existing CRM UI, generated named operation, API operation route, STDB reducer, and canonical `sale_order.opportunity_id` relation. It adds no sibling mutation authority and no generated-contract change.

## Result

- the versioned `sales-crm` persona has the least-privilege opportunity-stage and opportunity-line reads needed by the visible workflow;
- reducer idempotency is checked only after tenant, company, and opportunity validation;
- both pre-dispatch and post-create checks enforce exactly zero or one sale order for the tenant/company/opportunity relation;
- an existing single effect is an idempotent replay, while multiple effects are an explicit invariant failure rather than a newest-row choice;
- the browser path signs in as `fixture.sales@example.test`, creates the lead and opportunity through visible forms, converts it through the UI, and reads exactly one linked sale order;
- replay performs no second operation dispatch and preserves the same result identity;
- `fixture.reader@example.test` receives HTTP 403 from the named operation and creates no additional effect.

## Executed validation

- `cargo check --locked` in `spacetimedb`: passed with 10 existing warnings;
- `rustfmt --edition 2021 --check spacetimedb/src/crm/opportunities.rs`: passed;
- `pnpm --dir frontend/packages/query-hooks test`: 96 passed;
- `pnpm --dir frontend/packages/query-hooks typecheck`: passed;
- `pnpm --dir frontend/web exec playwright test tests/e2e/cov01d-opportunity-order-effect.spec.ts --project=unauthenticated --list`: one test listed;
- `PG_DATABASE=lumiere_cov03_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov03-e2e`: passed the fresh module publish, core/domain reducer suites, fixture provisioning, and healthy seven-persona/22-owner readback;
- `PG_DATABASE=lumiere_cov03_e2e make e2e-single E2E_SPEC=cov01d-opportunity-order-effect.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov03-e2e`: one browser test passed.

## Evidence limit

This accepts one CRM cross-module transition. Direct navigation and ambiguous/lost-response reconciliation are now implemented through the exact `sale_order.opportunity_id` + company relation. It does not prove stale-write behavior across the wider lead/contact lifecycle, duplicate-contact merge recovery, responsive/accessibility coverage, or complete CRM U4/U5 admission.

## Next slice

Start COV-04 with one Sales quotation/order operator transition and an explicit stable downstream identity. Reuse the accepted `sales-crm` persona and canonical Sales authority; do not expand this CRM slice into fulfillment or invoicing.

## Wave 3 certification additions

`cov26-crm-sales-resilience.spec.ts` adds targeted CRM operator evidence at 320px and 390px: the Contacts surface remains horizontally bounded, the create action is keyboard reachable, focus enters the modal and returns to its trigger on Escape, the read-only persona cannot reach create controls, and the canonical contacts query refetches after an offline window. Runtime execution remains part of the current-head COV-27 run; Playwright discovery is the local static gate.
