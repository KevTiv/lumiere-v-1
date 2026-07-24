//! Shared helpers for accounting domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, create_account_move, post_invoice,
    AccountMoveLine, AddAccountMoveLineParams, CreateAccountMoveParams,
};
use crate::test_harness::{chart_keys, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, JournalType, MoveType,
};

/// Create a balanced draft or posted customer invoice (AR debit / revenue credit).
pub fn create_balanced_customer_invoice(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    amount: f64,
    post: bool,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing AR account")?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;

    let journal_code = format!("TS{}", company_id);
    let journal_id = if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
    {
        j.id
    } else {
        create_account_journal(
            ctx,
            org_id,
            CreateAccountJournalParams {
                company_id: Some(company_id),
                name: "Test Sales Journal".to_string(),
                code: journal_code.clone(),
                type_: JournalType::Sale,
                currency_id: Some(1),
                default_account_id: Some(revenue_id),
                suspense_account_id: None,
                loss_account_id: None,
                profit_account_id: None,
                bank_account_id: None,
                payment_credit_account_id: None,
                payment_debit_account_id: None,
                invoice_reference_type: None,
                invoice_reference_model: None,
                sequence_id: None,
                refund_sequence_id: None,
                sequence_override_regex: None,
                secure_sequence_id: None,
                alias_name: None,
                alias_domain: None,
                sale_activity_type_id: None,
                sale_activity_user_id: None,
                sale_activity_note: None,
                sale_activity_date_deadline: None,
                restrict_mode_hash_table: false,
                active: true,
                at_least_one_inbound: true,
                at_least_one_outbound: true,
                dedicated_payment_method_ids: vec![],
                sale_activity_done: false,
                metadata: None,
            },
        )?;
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.organization_id == org_id && j.code == journal_code)
            .map(|j| j.id)
            .ok_or("Test sales journal not found after create")?
    };

    create_account_move(
        ctx,
        org_id,
        CreateAccountMoveParams {
            company_id: Some(company_id),
            journal_id,
            move_type: MoveType::OutInvoice,
            date: ctx.timestamp,
            name: String::new(),
            ref_: Some("Harness customer invoice".to_string()),
            auto_post: false,
            to_check: false,
            is_storno: false,
            partner_id: Some(fixture.partner_id),
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_date: Some(ctx.timestamp),
            invoice_date_due: None,
            invoice_payment_term_id: None,
            payment_reference: None,
            invoice_origin: None,
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            partner_shipping_id: None,
            sale_order_id: None,
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            secure_sequence_number: None,
            metadata: Some(r#"{"test":"balanced_customer_invoice"}"#.to_string()),
        },
    )?;

    let move_id = ctx
        .db
        .account_move()
        .iter()
        .find(|m| {
            m.organization_id == org_id
                && m.ref_ == Some("Harness customer invoice".to_string())
                && m.state == AccountMoveState::Draft
        })
        .map(|m| m.id)
        .ok_or("Draft customer invoice not found after create")?;

    add_account_move_line(
        ctx,
        org_id,
        move_id,
        AddAccountMoveLineParams {
            account_id: ar_id,
            name: "Accounts Receivable".to_string(),
            debit: amount,
            credit: 0.0,
            sequence: 1,
            quantity: 1.0,
            price_unit: amount,
            discount: 0.0,
            tax_ids: vec![],
            partner_id: Some(fixture.partner_id),
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
        },
    )?;

    // Lines come from add_account_move_line → insert stamps Debug casing ("Receivable").
    // Reconcile is case-insensitive (A1); do not patch casing here for payment settlement proofs.
    // Payment settlement tests must NOT call patch_receivable_line_type.

    add_account_move_line(
        ctx,
        org_id,
        move_id,
        AddAccountMoveLineParams {
            account_id: revenue_id,
            name: "Product Sales".to_string(),
            debit: 0.0,
            credit: amount,
            sequence: 2,
            quantity: 1.0,
            price_unit: amount,
            discount: 0.0,
            tax_ids: vec![],
            partner_id: Some(fixture.partner_id),
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
        },
    )?;

    if post {
        post_invoice(ctx, org_id, move_id, revenue_id, revenue_id)?;
    }

    Ok(move_id)
}

/// Legacy helper: force lowercase `receivable` on an AR line.
///
/// **Payment settlement tests must NOT use this.** Reconcile matches case-insensitively
/// (`Receivable` from insert is enough). Keep only for unrelated tests that still need
/// an explicit residual/type stamp outside the payment path.
pub fn patch_receivable_line_type(
    ctx: &ReducerContext,
    move_id: u64,
    ar_account_id: u64,
) -> Result<(), String> {
    let line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .find(|l| l.account_id == ar_account_id)
        .ok_or("AR move line not found for patch")?;

    ctx.db.account_move_line().id().update(AccountMoveLine {
        account_internal_type: Some("receivable".to_string()),
        amount_residual: (line.credit - line.debit).abs(),
        amount_residual_currency: (line.credit - line.debit).abs(),
        ..line
    });

    Ok(())
}

/// Seed a bank journal + liquidity account for payment tests.
pub fn seed_bank_journal(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<(u64, u64), String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let suffix = fixture.company_id;

    let type_name = format!("Bank {suffix}");
    if ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.name == type_name)
        .is_none()
    {
        create_account_account_type(
            ctx,
            org_id,
            CreateAccountAccountTypeParams {
                company_id: Some(company_id),
                name: type_name.clone(),
                type_: "liquidity".to_string(),
                internal_group: AccountInternalGroup::Asset,
                include_initial_balance: false,
                metadata: None,
            },
        )?;
    }

    let at_liquidity = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.name == type_name)
        .map(|t| t.id)
        .ok_or("Test bank account type not found")?;

    let bank_code = format!("1010{suffix}");
    if ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.code == bank_code)
        .is_none()
    {
        create_account_account(
            ctx,
            org_id,
            CreateAccountAccountParams {
                company_id: Some(company_id),
                code: bank_code.clone(),
                name: "Test Bank".to_string(),
                user_type_id: at_liquidity,
                currency_id: None,
                internal_type: Some(AccountTypeInternal::Liquidity),
                internal_group: Some(AccountInternalGroup::Asset),
                group_id: None,
                reconcile: false,
                tax_ids: vec![],
                note: None,
                opening_debit: 0.0,
                opening_credit: 0.0,
                allowed_journal_ids: vec![],
                non_trade: false,
                is_off_balance: false,
                metadata: None,
            },
        )?;
    }

    let bank_account_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.code == bank_code)
        .map(|a| a.id)
        .ok_or("Test bank account not found")?;

    let journal_code = format!("TB{}", suffix);
    let journal_id = if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.code == journal_code)
    {
        j.id
    } else {
        create_account_journal(
            ctx,
            org_id,
            CreateAccountJournalParams {
                company_id: Some(company_id),
                name: "Test Bank Journal".to_string(),
                code: journal_code.clone(),
                type_: JournalType::Bank,
                currency_id: Some(1),
                default_account_id: Some(bank_account_id),
                suspense_account_id: None,
                loss_account_id: None,
                profit_account_id: None,
                bank_account_id: Some(bank_account_id),
                payment_credit_account_id: None,
                payment_debit_account_id: None,
                invoice_reference_type: None,
                invoice_reference_model: None,
                sequence_id: None,
                refund_sequence_id: None,
                sequence_override_regex: None,
                secure_sequence_id: None,
                alias_name: None,
                alias_domain: None,
                sale_activity_type_id: None,
                sale_activity_user_id: None,
                sale_activity_note: None,
                sale_activity_date_deadline: None,
                restrict_mode_hash_table: false,
                active: true,
                at_least_one_inbound: true,
                at_least_one_outbound: true,
                dedicated_payment_method_ids: vec![],
                sale_activity_done: false,
                metadata: None,
            },
        )?;
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.code == journal_code)
            .map(|j| j.id)
            .ok_or("Test bank journal not found after create")?
    };

    Ok((journal_id, bank_account_id))
}
