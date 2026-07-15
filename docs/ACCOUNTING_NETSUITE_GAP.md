# Accounting — NetSuite-quality gap ledger

Living checklist from the Accounting & Financial Management investigation.
Update status cells when work lands. NetSuite is a **quality bar**, not a clone spec.

## Status legend

| Status | Meaning |
|--------|---------|
| Present | Shipped and usable |
| Partial | Exists but incomplete vs invariants / lifecycle |
| Absent | Not implemented |
| Unsuitable | Exists but architecture blocks correct use |

## Gap matrix

| Capability | Status | Notes |
|------------|--------|-------|
| GL / balanced post / period lock | Present | Open period **required**; closed period blocks |
| AR / AP core | Present | Credit hold/limit gate on invoice post |
| Payments / bank recon | Present | |
| Unrealized FX | Partial → improved | Manual lines + **batch from open AR/AP** |
| Realized FX | Present | `post_realized_fx_gain_loss` |
| Deferred rev-rec → GL | Present | `recognize_deferred_revenue` posts balanced move |
| Accrual / prepaid amort | Present | `amortization_schedule` / `recognize_amortization_line` |
| Write-off / bad debt | Present | `create_bad_debt_write_off` |
| Credit control | Present | `partner_credit_control` |
| Collections / dunning | Absent | |
| Financial statements | Present | TB + BS / P&L / CF lines + aging JSON |
| Close checklist | Partial | UI + live signal wiring (TB step); no persisted tasks |
| Country packs → live tax | Present | `set_company_country_pack` materializes `AccountTax` |
| Withholding tax type | Present | `TaxTypeUse::Withholding` |
| BR / SEA packs | Present | Catalog stubs (br/ar/cl/my/id/th/ph) |
| E-invoice / statutory adapters | Partial | API seam `/v1/statutory-adapters/*` (stub) |
| Multi-book / restatement | Absent | |
| Finance SoD presets | Present | Org migration `seed_finance_sod_presets` |
| Real-time close subscriptions | Present | Bank/payments/fiscal SQL builders added |

## Invariants (must hold)

1. Atomic balanced posting in one reducer
2. Open period required for posting dates; closed period wins if overlapping
3. Posted immutability
4. Org/company scope guards
5. Metadata / configuration from **params** — never invent `None` when callers supply it
6. Pack legislation stays in pack tables + external adapters — not hardcoded in post reducers
7. Audit with `write_audit_log_v2` on mutating finance reducers

## Priority classes

| Class | Items |
|-------|-------|
| Pilot-critical | Balanced post, period lock, TB+drill-down, pack→tax, checklist signals |
| Competitive | BS/P&L/CF/aging, GL rev-rec, realized FX, amortizations, credit, SoD |
| Differentiating | Live subscriptions close, jurisdiction adapters, atomic fail-fast posting |

## Acceptance scenarios (track)

1. Unbalanced draft cannot post — covered
2. Closed / missing open period blocks post — covered
3. Posted line edit blocked — covered
4. Payment allocate + TB balance — existing
5. FX batch + realized FX — reducers added; extend domain tests
6. Deferred revenue recognize creates GL — reducer; add test
7. Pack enable upserts AccountTax — reducer; extend country pack test
8. Credit hold / limit blocks invoice post — helper wired; add test
9. Statutory export adapter returns stub acceptance — API route
10. ReportType BalanceSheet populates `balance_sheet_line` — generator

## Related

- [MULTI_ENTITY_PLATFORM_INVENTORY.md](./MULTI_ENTITY_PLATFORM_INVENTORY.md)
- Backend: `spacetimedb/src/accounting/`
- Adapters: `api-server/src/routes/statutory_adapters.rs`
