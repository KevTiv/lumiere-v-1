# COV-01 reference spine acceptance

**Package:** `COV-01`
**Disposition:** `ACCEPTED` — representative shared operation-result spine only
**Base:** `746d98b7e13f2b1f7d504e89db61cd9dcaff06fa`
**Browser proof:** [`../../frontend/web/tests/e2e/cov01d-opportunity-order-effect.spec.ts`](../../frontend/web/tests/e2e/cov01d-opportunity-order-effect.spec.ts)

## Accepted runtime path

```text
operator UI:             CRM opportunity conversion modal
generated operation:     erp.convert_opportunity_to_sale_order
trusted dispatch:        api-server operation route + current company authorization
canonical STDB owner:    convert_opportunity_to_sale_order
effect identity:         organization_id + company_id + opportunity_id
effect cardinality:      exactly zero or one sale order
semantic outcomes:       converged, already-applied, rejected, outcome-unknown
result ref:              /sales?tab=orders&filter=id:<sale_order_id>
shared presentation:     semantic operation outcome adapter + workflow toast
```

## Result

- the representative command uses the generated operation contract and returns transport receipt metadata without treating dispatch acceptance as business success;
- the CRM hook reads the exact canonical sale-order relation before and after dispatch and rejects duplicate relations instead of selecting a newest or partner-matched row;
- resolved and already-applied outcomes carry the stable sale-order record reference into the shared form outcome adapter;
- rejected and outcome-unknown paths retain typed error and recovery semantics, keep the populated form open with an inline error, and do not retry an ambiguous dispatch blindly;
- the operator can open the resulting sale order directly, and the filtered record remains visible after browser refresh;
- a second conversion does not dispatch again or create another sale order;
- the limited reader persona is denied the same operation.

## Executed validation

- `docker compose --env-file .env.docker -f docker-compose.dev.yml run --rm --no-deps web pnpm --filter @lumiere/ui exec vitest run src/lib/semantic-operation-outcome.test.ts`: 2 passed;
- `docker compose --env-file .env.docker -f docker-compose.dev.yml run --rm --no-deps -e NODE_OPTIONS=--max-old-space-size=4096 web pnpm --filter @lumiere/ui typecheck`: passed;
- `docker compose --env-file .env.docker -f docker-compose.dev.yml run --rm --no-deps web pnpm --dir packages/query-hooks exec node --import tsx --test src/hooks/operation-effect.test.ts src/hooks/operation-effect-refresh.test.ts src/hooks/crm-opportunity-outcome-ui.test.ts`: 14 passed;
- `docker compose --env-file .env.docker -f docker-compose.dev.yml run --rm --no-deps -e NODE_OPTIONS=--max-old-space-size=4096 web pnpm --dir web exec tsc --noEmit --incremental false`: passed;
- `docker compose --env-file .env.docker -f docker-compose.dev.yml run --rm --no-deps api-server cargo test --locked -p api-server --lib routes::operations -- --nocapture`: 2 passed;
- `make e2e-docker E2E_STDB_MODULE=lumiere-cov01-docker-20261007 E2E_CLEAR_DB=1 E2E_SPEC_FILES=cov01d-opportunity-order-effect.spec.ts E2E_GREP= E2E_WORKERS=1`: full Docker setup, domain reducer checks, direct result navigation, refresh readback, replay, denial, and durable projection settlement.

All runtime services and the Playwright browser ran in Docker. The host ran only the orchestration commands.

## Evidence limit

COV-01 accepts one representative shared workflow spine. It does not promote CRM or Sales to U5, and it does not prove that all module actions use this adapter. Each module package must still prove its own exact effect identity, cardinality, authorization, stale/replay behavior, recovery, and operator path.

## Next slice

Start the first bounded adoption action from the follow-up sequence. Reuse this shared outcome adapter and require the module-owned operation to supply its canonical result reference and domain-specific copy.
