# [psa-advanced] Mission — forecast, change orders, EVM, subcontractors, rev-rec

**Handle:** `[psa-advanced]`  
**Wave:** E (differentiating)  
**Depends on:** Wave D gate  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Deliver differentiating PSA: capacity forecasting, change-order rebaseline, earned-value metrics, subcontractor cost into margin, **project-owned** POC/milestone revenue recognition (not subscription tables), integration intents, and optional offline timesheet outbox.

## Architecture constraints (from investigation §6)

- Project rev-rec schedules keyed by `project_id` / milestone — **share posting helpers** with accounting; do **not** write into `deferred_revenue_schedule` subscription rows unless an explicit bridge task says so.
- External calendar/payroll/e-invoice → durable integration intent + workers/procedures; no HTTP in reducers.
- Reuse expense delayed-sync / outbox patterns where applicable.

## Out of scope

- Replacing Wave A–D spines
- SuiteApp feature-copy laundry list
- Platform SaaS `billing_account`

---

## Phase 1 — Forecast + change orders + EVM

1. Forward allocation vs pipeline capacity forecast projection.
2. Change order: scope/budget/rate deltas; retain baseline; audit.
3. EVM fields: PV/EV/AC, SPI/CPI from baseline + validated progress + actual cost.

### Verify

```bash
rg 'change_order|earned_value|forecast' spacetimedb/src/projects/ --glob '*.rs' | head -25
```

---

## Phase 2 — Subcontractors + project rev-rec + integrations + mobile

1. Link vendor PO / bill lines to project → cost in margin.
2. Project revenue recognition schedule + recognize reducer (POC % or milestone).
3. `project_integration_intent` for payroll export / calendar sync / e-invoice.
4. Offline timesheet outbox + conflict UI (pattern from expenses Wave E).

### Success criteria

- [x] Change order rebaseline with dual baselines
- [x] EVM metrics computable and visible
- [x] Subcontractor cost in project margin
- [x] Project rev-rec posts JE without mutating subscription schedules
- [x] At least one integration intent + worker stub
- [x] Domain tests for change-order + rev-rec isolation
