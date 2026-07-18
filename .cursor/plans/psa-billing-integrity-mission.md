# [psa-billing-integrity] Mission — sell-rate bill + tax + period lock

**Handle:** `[psa-billing-integrity]`  
**Wave:** A  
**Depends on:** `[psa-time-approval]` Phase 1 sell_rate field (or land sell_rate in the same batch before this track’s bill changes)  
**Tracker:** [docs/plans/projects-psa-gap-fixes-plan.md](../../docs/plans/projects-psa-gap-fixes-plan.md)

## Goal

Make `bill_timesheets` financially honest for pilot: invoice lines use **sell rate**, compute tax, respect accounting period open, keep atomic link of `timesheet_invoice_id`.

**Exit criteria:** Draft OutInvoice lines priced from sell rate; `amount_tax` / totals reflect tax; period lock rejects bill when closed; still single-reducer atomic with timesheet links.

## Why this exists

Investigation: `price_unit = employee_cost`, `amount_tax: 0.0`, no period gate — unsuitable for close.

## Primary artifacts

| Artifact | Path |
|----------|------|
| Bill reducer | `spacetimedb/src/accounting/journal_entries.rs` (`bill_timesheets`, `BillTimesheetsParams`) |
| Timesheet table | `spacetimedb/src/projects/timesheets.rs` |
| Period helpers | search `ensure_accounting_period_open` in accounting |
| Tax helpers | reuse patterns from sales/subscription invoice tax if present |
| Country packs | `spacetimedb/src/core/country_pack.rs` |

## Out of scope

- Rate card catalogue (Wave B)
- Milestone / fixed-fee billing (Wave D)
- Project rev-rec (Wave E)
- Second AR create path
- Full UI tax pickers beyond existing Bill toolbar params

---

## Phase 1 — Price from sell_rate + period lock

### 1.1 Preconditions

Confirm `ProjectTimesheet` has sell rate field from `[psa-time-approval]`. If missing, **stop** and report blocker — do not invent parallel field names.

### 1.2 Bill math

In `bill_timesheets`:

- Line `price_unit` = sell rate; `quantity` = hours; subtotal = hours × sell rate.
- Header untaxed = sum of lines.
- Reject if any sheet not validated / not billable / already invoiced (keep).
- Prefer rejecting mixed currencies unless FX Wave B exists (document; fail closed if currencies differ).

### 1.3 Period lock

Call existing `ensure_accounting_period_open` (or equivalent) for invoice date before insert.

### Verify Phase 1

```bash
rg 'sell_rate|employee_cost' spacetimedb/src/accounting/journal_entries.rs
rg 'ensure_accounting_period_open' spacetimedb/src/accounting/journal_entries.rs
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -8
```

### Success criteria

- [ ] Bill lines use sell rate, not cost
- [ ] Period open enforced
- [ ] Atomic `timesheet_invoice_id` update retained
- [ ] `cargo check` passes

---

## Phase 2 — Tax on services invoice

### 2.1 Tax compute

- Extend `BillTimesheetsParams` with optional `tax_ids` / fiscal position if needed for pilot.
- Or derive default sale tax from company country pack for services.
- Set `amount_tax`, `amount_total`, line tax fields consistently with other OutInvoice creators in this codebase.

### 2.2 Audit

Enrich audit `new_values` with untaxed, tax, timesheet_count, currency.

### Verify Phase 2

```bash
rg 'amount_tax' spacetimedb/src/accounting/journal_entries.rs
rg 'BillTimesheetsParams' spacetimedb/src/accounting/journal_entries.rs -A 20
cargo check --manifest-path spacetimedb/Cargo.toml 2>&1 | tail -5
```

### Success criteria

- [ ] Non-zero tax path possible when pack/tax configured
- [ ] Totals consistent (untaxed + tax = total)
- [ ] Bindings regenerated if params changed
- [ ] UI Bill form passes new tax args if required (minimal FormConfig update)
