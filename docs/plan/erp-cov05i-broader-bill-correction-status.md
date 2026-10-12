# COV-05i — broader draft bill correction

> Producer follow-up: [COV-05j](erp-cov05j-tax-fx-bill-creation-status.md) now creates explicit tax/FX accounting rows from the existing bill command. Its source validation and runtime limits are recorded separately.

Date: 2026-10-12 (Europe/Amsterdam). Integration lane: PR #179.

## Supported correction shapes

The existing v0.3.102 quantity/price correction command now preserves each
expense line's finite 0–100% discount, including fully discounted lines.
Discount editing is not added to this command. Reviewed quantity and unit price,
exact PO/bill/source membership, current company access, receipt conservation
and never-posted Draft requirements remain mandatory.

Percentage purchase taxes support price-included and price-excluded rules,
including multiple non-compounding rates. Each rule must be active and scoped
to the company, explicitly referenced by expense `tax_ids`, and represented by
one aggregate journal row with the exact `tax_line_id`. Correction recalculates
the expense net/gross amounts, each tax amount/base, and the payable. It neither
infers rules from PO `price_tax` nor creates missing tax journal identities or
account mappings. Existing PO-produced tax amounts without these relationships
still require producer work; they are rejected, not silently normalized.

Foreign-currency correction resolves the existing canonical rate as of the
invoice date (document date fallback), using company-specific precedence over
organization-wide rates. Both currencies must be active and tenant-owned;
company currency must match the actual company. Ledger components use company
currency rounding. Every old expense, tax and payable amount must agree with
the canonical rate and its document-currency value before any writes. Changed
or absent rate evidence and inconsistent legacy FX records fail closed. The
correction audit records currencies, applied rate, preserved discount and tax IDs.

Invoice totals now distinguish document-currency face value/residual from
company-currency signed accounting totals. This corrects the previous use of
ledger balances as foreign invoice totals; same-currency amounts retain the
existing arithmetic. Quantity, unit price and monetary journal values are
validated separately, so the payable remains balanced after component rounding.

## Preserved boundaries

- One canonical payable; all expense lines need exact source membership.
- No posted/reconciled edits or legacy lineage guessing.
- Fixed/division/code taxes, withholding, negative tax factors, compounding and
  tax repartition require their own canonical accounting support. Duplicate,
  missing, dangling or inconsistent tax rows are rejected.
- No contract/codec change or new command: release remains v0.3.102.
- No new claim of integrated runtime acceptance or localhost backend publication.

## Verification

- Five pure Rust arithmetic tests executed against the production math module:
  discount-before-tax, inclusive/exclusive tax base, full discount, invalid and
  overflowing values, FX conversion/rounding and invalid rates.
- Five web correction tests passed, including tax/discount/FX eligibility and
  unchanged reviewed-value parameters.
- Web TypeScript check passed.
- Native `cargo check --locked --offline --manifest-path spacetimedb/Cargo.toml --lib`
  passed with 14 existing warnings, including the expanded reducer fixtures.
  Compiled fixtures do not constitute reducer execution.
- The existing Purchasing wave test now authors actual correction calls for
  discount, tax, and combined tax/FX shapes, plus missing-tax-row and changed-rate
  rejection and ledger/document conservation checks. Runtime execution is deferred.
- v0.3.102 release-manifest verification, targeted Rust formatting and
  `git diff --check` passed.

Full operator acceptance remains deferred as requested. A fresh integrated
backend build/publication and runtime gate must precede promotion of this slice.
