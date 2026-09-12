use spacetimedb::ReducerContext;

use crate::accounting::chart_of_accounts::account_account;
use crate::accounting::journal_entries::AddAccountMoveLineParams;

/// Construct a journal line with explicit debit/credit/sequence.
///
/// Computes `quantity` (1.0 when amount-bearing, 0.0 otherwise) and
/// `price_unit` (max of debit/credit). All other fields default to
/// zero/empty/None. Callers override domain-specific fields after
/// construction.
pub(crate) fn journal_line_params(
    account_id: u64,
    name: String,
    debit: f64,
    credit: f64,
    sequence: u32,
) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit,
        credit,
        sequence,
        quantity: if debit > 0.0 || credit > 0.0 {
            1.0
        } else {
            0.0
        },
        price_unit: debit.max(credit),
        discount: 0.0,
        tax_ids: vec![],
        partner_id: None,
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: false,
        blocked: false,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_repartition_line_id: None,
        tax_audit: None,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        matching_number: None,
        matching_label: None,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        metadata: None,
    }
}

/// Construct a blank journal line with zero debit/credit and default quantity.
///
/// Used by callers that overwrite numeric fields after construction.
/// Differs from `journal_line_params` by hardcoding debit=0, credit=0,
/// sequence=0, quantity=1.0, price_unit=0.0.
pub(crate) fn blank_journal_line(account_id: u64, name: String) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit: 0.0,
        credit: 0.0,
        sequence: 0,
        quantity: 1.0,
        price_unit: 0.0,
        discount: 0.0,
        tax_ids: vec![],
        partner_id: None,
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: false,
        blocked: false,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_repartition_line_id: None,
        tax_audit: None,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        matching_number: None,
        matching_label: None,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        metadata: None,
    }
}

/// Validate that an account belongs to the given company.
///
/// This is a company-only check (no organization scoping, no deprecated guard).
/// It is intentionally weaker than `require_active_account` in `relations.rs`;
/// callers that need full org+company+active validation should use that instead.
pub(crate) fn validate_company_account(
    ctx: &ReducerContext,
    company_id: u64,
    account_id: u64,
    label: &str,
) -> Result<(), String> {
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or_else(|| format!("{label} account not found"))?;
    if account.company_id != company_id {
        return Err(format!("{label} account does not belong to this company"));
    }
    Ok(())
}
