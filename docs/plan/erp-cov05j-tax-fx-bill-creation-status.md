# COV-05j — tax/FX vendor-bill creation

Date: 2026-10-12 (Europe/Amsterdam). Integration lane: PR #179.
Disposition: implemented source; integrated runtime acceptance deferred.

## Operator path

The existing Create bill from purchase order form selects an explicit company
purchase tax and a finite 0–100% supplier discount. Its selected tax applies to
all billable lines. The PO owns document currency; the bill date selects the
canonical exchange rate. The UI presents active, non-compounding percentage
purchase rules with a tax group and no invoice repartition. No tax is inferred
from product names, amounts or the most recent tax row.

These inputs use the existing expense-line tax_ids and discount fields in
CreateBillFromPurchaseOrderParams. There are no new public reducer parameters,
tables or SDK codecs; the contracts pin remains v0.3.102.

## Producer guarantees

- Scope, active accounts and payable roles, template shape, tax group/account
  mappings, rates and finite line/tax amounts are validated before inserting a
  bill. Invalid evidence must not create accounting rows or consume quantities.
- A selected tax must be an active scoped non-compounding percentage purchase
  rule. Its group must explicitly configure an active company input-tax asset
  account outside receivable/payable control. Missing mappings are rejected.
- Explicit selected rules are checked against each PO line's retained tax
  amount, scaled by the exact ordered/received ratio and discount. Fractional
  ordered quantities no longer use a denominator clamped to one. This is a
  consistency check; the aggregate amount never discovers a tax identity.
- The bill retains PO currency even when its journal uses company currency.
  An unrelated dedicated journal currency is rejected. Foreign bills resolve
  canonical invoice-date rates and company rounding through the same owner
  used by correction; missing rates are not replaced with a guessed ratio.
- Each product expense has one exact source invoice_lines edge. Each selected
  tax has one aggregate journal row with tax_line_id, tax_group_id and tax base.
  Expense, tax and payable rows carry document-currency amounts and balanced
  company-currency debit/credit amounts. Component rounding is included in the
  payable, preventing a fractional FX imbalance.
- Accounting's shared totals owner computes face value/residual in document
  currency and signed totals in company currency. Purchasing owns received-based
  invoice coverage and residual quantities. Later receipt cycles create a new
  exact bill without rewriting an earlier bill.
- New bills can enter COV-05i correction directly with their producer-owned tax
  and currency evidence. Bill creation audit records tax IDs, discount, rate and
  both currency totals.

## Canonical readback

The app API's account-taxes resource projection now includes active/type/rate
kind, inclusion/compounding flags, tax-group ID and invoice repartition IDs.
The tax selector reads these producer-owned columns. The repartition-ID array
is allowed for this resource by the existing HTTP column policy, after resource
and field authorization; selective field permissions continue to withhold it.
The canonical app registry and generated metadata were refreshed via codegen.
This additive API projection does not require a new SDK command or table shape.

## Boundaries

The operator form selects one shared tax rule for the bill; heterogeneous
per-source tax sets need another input contract. API callers can supply explicit
multiple non-compounding rules through the existing tax_ids array when every
line agrees with the PO tax aggregate. Fixed/division/code/withholding,
compounding and repartitioned taxes remain rejected. Missing legacy source/tax
links are not backfilled. Posted/reconciled bills still require their own workflow.

This slice does not persist original PO tax-rule identities, redesign included
PO tax totals, or certify durable receipt replay. It uses reviewed explicit bill
tax choices with existing aggregate consistency evidence. No localhost backend
publication or fresh operator acceptance is claimed.

## Validation

- Six production Rust arithmetic tests passed, including partial/fractional
  tax evidence and discount/inclusive tax/FX rounding regressions.
- Twelve form-parameter tests and nine Purchasing form tests passed; five new
  cases cover selected tax/discount, malformed IDs, percentage bounds and tax
  eligibility. Web TypeScript checking passed.
- Codegen and v0.3.102 release-manifest verification passed.
- Tax projection/field-permission regression passed in the field-policy suite.
  The broader suite reports 27 passed, one pre-existing Helpdesk failure:
  resolve_http_sql_columns_exposes_helpdesk_lifecycle_without_customer_pii
  expects user_id absent while the unchanged base registry includes it. Both
  contradictory definitions were verified at the pre-slice HEAD. This suite
  is not claimed green; the unrelated failure remains open.
- Final native module/fixture compilation passed with 14 existing warnings;
  targeted Rust formatting and `git diff --check` passed. Reducer fixtures are authored and compiled,
  not executed: untaxed FX, exclusive tax, tax+FX and inclusive tax+FX, two
  receipt/bill cycles, correction of a generated bill, unchanged first bill,
  and rejection of missing rate/account, missing tax choice and duplicate IDs.

Runtime activation and full Purchasing acceptance remain deferred.
