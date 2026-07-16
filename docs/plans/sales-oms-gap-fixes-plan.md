# Sales OMS Gap Fixes — Tracker

Executable tracker for the full backlog plan (Pilot → Competitive → Differentiating). Source investigation: [../SALES_ORDER_MANAGEMENT_INVESTIGATION.md](../SALES_ORDER_MANAGEMENT_INVESTIGATION.md).

## Wave A — Pilot integrity (landed)

- [x] `lock_sale_order` / `unlock_sale_order` reducers + mutation guards
- [x] `update_sale_order_line` / `delete_sale_order_line` reducers + UI delete
- [x] Company isolation + FX fail-closed + lock/line domain tests in `run_all_sales_tests`
- [x] Confirm/send/cancel error surfacing; invoiced cancel → RMA guidance

## Wave B — Competitive productization (landed MVP)

- [x] Dropship form field + domain test
- [x] Apply promotion / apply CPQ options order actions
- [x] Exchange domain test + over-return residual guard
- [x] First-class `currency_rate` + `invoice_policy`
- [x] Ops → Workflow approve deep-link
- [x] Sales Ops dedicated SoD Approve / Reject (inbox match + requester disable; Workflow secondary)
- [x] Server-bounded exception QueryResourceKey SQL (`sale-orders-to-approve`, `sale-commissions-pending`, `partner-credit-holds`)

## Wave C — Competitive depth (landed MVP)

- [x] `accept_sale_order_quotation`
- [x] Split OUT pickings by `route_id`
- [x] Delivery-based invoicing path
- [x] Commercial packet JSON export

## Wave D — Differentiating (MVP tables/reducers)

- [x] `oms_advanced.rs`: commission plans/splits, contracts, CPQ constraints, integration intents, SLA schedule, omnichannel allocation
- [x] Sales UI (Ops + dashboard quick actions) for advanced creates — BFF allowlist + query-hooks; no entity list tabs (QueryResourceKey missing)
- [ ] Full e2e coverage

## Ops checklist after merge

1. `make generate-stdb-ts-sdk` and `make generate-stdb-rust-sdk`
2. `spacetime publish` (or local) with module path
3. `spacetime call <db> run_all_sales_tests`
4. Playwright: `mvp-lead-to-cash`, `mvp-sales-returns`, `sales-mutations`

## Audit coverage notes (POS / thin OMS)

Added `write_audit_log_v2` on POS config/session/loyalty mutators, `apply_sale_order_options`, and `schedule_sales_sla_escalation`. `delivery_shipping` reducers already audited.

Intentional gaps (no audit):
- `compute_pos_session_totals` — derived cash-register total recompute only
- `run_sales_sla_escalation` — scheduled scan/log; does not mutate domain rows
- `pricelists` update/delete/item mutators — outside this sweep (still partial)
