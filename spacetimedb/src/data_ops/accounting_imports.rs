/// Accounting CSV Imports — AccountAccount, AccountTax, AccountMove, AccountMoveLine,
/// CrossoveredBudget, CrossoveredBudgetLines, AccountAnalyticAccount
use spacetimedb::{ReducerContext, Table};

use crate::accounting::analytic_accounting::{account_analytic_account, AccountAnalyticAccount};
use crate::accounting::budgeting::{
    crossovered_budget, crossovered_budget_lines, CrossoveredBudget, CrossoveredBudgetLines,
};
use crate::accounting::chart_of_accounts::{account_account, AccountAccount};
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::tax_management::{account_tax, AccountTax};
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::types::{
    AccountMoveState, BudgetState, MoveType, PaymentState, TaxAmountType, TaxTypeUse,
};

// ── AccountAccount ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_account_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "account_account",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let code = col(&headers, row, "code").to_string();
        let name = col(&headers, row, "name").to_string();

        if code.is_empty() || name.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("code"),
                Some(&code),
                "code and name are required",
            );
            errors += 1;
            continue;
        }

        let user_type_id = parse_u64(col(&headers, row, "user_type_id"));

        ctx.db.account_account().insert(AccountAccount {
            id: 0,
            organization_id,
            code,
            name,
            deprecated: false,
            used: false,
            user_type_id,
            company_id,
            currency_id: opt_u64(col(&headers, row, "currency_id")),
            internal_type: None,
            internal_group: None,
            is_off_balance: parse_bool(col(&headers, row, "is_off_balance")),
            last_time_entries_checked: None,
            group_id: opt_u64(col(&headers, row, "group_id")),
            root_id: None,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_bank_account: parse_bool(col(&headers, row, "is_bank_account")),
            reconcile: parse_bool(col(&headers, row, "reconcile")),
            tax_ids: vec_u64(col(&headers, row, "tax_ids")),
            note: opt_str(col(&headers, row, "note")),
            opening_debit: parse_f64(col(&headers, row, "opening_debit")),
            opening_credit: parse_f64(col(&headers, row, "opening_credit")),
            opening_balance: parse_f64(col(&headers, row, "opening_balance")),
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_account: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountTax ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_tax_rate_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "account_tax", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let type_tax_use = match col(&headers, row, "type_tax_use") {
            "purchase" => TaxTypeUse::Purchase,
            "none" => TaxTypeUse::None,
            _ => TaxTypeUse::Sale,
        };

        let amount_type = match col(&headers, row, "amount_type") {
            "fixed" => TaxAmountType::Fixed,
            "division" => TaxAmountType::Division,
            "code" => TaxAmountType::PythonCode,
            _ => TaxAmountType::Percent,
        };

        ctx.db.account_tax().insert(AccountTax {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            type_tax_use,
            amount_type,
            amount: parse_f64(col(&headers, row, "amount")),
            active: true,
            price_include: parse_bool(col(&headers, row, "price_include")),
            include_base_amount: parse_bool(col(&headers, row, "include_base_amount")),
            is_base_affected: true,
            sequence: parse_u32(col(&headers, row, "sequence")),
            company_id,
            tax_group_id: opt_u64(col(&headers, row, "tax_group_id")),
            country_id: opt_u64(col(&headers, row, "country_id")),
            country_code: opt_str(col(&headers, row, "country_code")),
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_tax: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountMove ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_account_move_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "account_move",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let journal_id = parse_u64(col(&headers, row, "journal_id"));
        let currency_id = parse_u64(col(&headers, row, "currency_id"));

        if journal_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("journal_id"),
                None,
                "journal_id is required",
            );
            errors += 1;
            continue;
        }

        let move_type = match col(&headers, row, "move_type") {
            "out_invoice" => MoveType::OutInvoice,
            "out_refund" => MoveType::OutRefund,
            "in_invoice" => MoveType::InInvoice,
            "in_refund" => MoveType::InRefund,
            "out_receipt" => MoveType::OutInvoice,
            "in_receipt" => MoveType::InInvoice,
            _ => MoveType::Entry,
        };

        let date = opt_timestamp(col(&headers, row, "date")).unwrap_or(ctx.timestamp);

        ctx.db.account_move().insert(AccountMove {
            id: 0,
            organization_id,
            name: col(&headers, row, "name").to_string(),
            ref_: opt_str(col(&headers, row, "ref_")),
            move_type,
            auto_post: false,
            state: AccountMoveState::Draft,
            date,
            invoice_date: opt_timestamp(col(&headers, row, "invoice_date")),
            invoice_date_due: opt_timestamp(col(&headers, row, "invoice_date_due")),
            invoice_payment_term_id: opt_u64(col(&headers, row, "invoice_payment_term_id")),
            invoice_origin: opt_str(col(&headers, row, "invoice_origin")),
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            payment_reference: opt_str(col(&headers, row, "payment_reference")),
            partner_shipping_id: None,
            sale_order_id: None,
            partner_id: opt_u64(col(&headers, row, "partner_id")),
            commercial_partner_id: None,
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_user_id: Some(ctx.sender()),
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            company_id,
            journal_id,
            currency_id,
            company_currency_id: currency_id,
            amount_untaxed: parse_f64(col(&headers, row, "amount_untaxed")),
            amount_tax: parse_f64(col(&headers, row, "amount_tax")),
            amount_total: parse_f64(col(&headers, row, "amount_total")),
            amount_residual: parse_f64(col(&headers, row, "amount_total")),
            amount_untaxed_signed: 0.0,
            amount_tax_signed: 0.0,
            amount_total_signed: 0.0,
            amount_total_in_currency_signed: 0.0,
            amount_residual_signed: 0.0,
            to_check: false,
            posted_before: false,
            is_storno: false,
            is_move_sent: false,
            secure_sequence_number: None,
            invoice_has_outstanding: false,
            payment_state: PaymentState::NotPaid,
            restrict_mode_hash_table: false,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_move: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountMoveLine ───────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_account_move_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "account_move_line",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let move_id = parse_u64(col(&headers, row, "move_id"));
        let account_id = parse_u64(col(&headers, row, "account_id"));

        if move_id == 0 || account_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("move_id"),
                None,
                "move_id and account_id are required",
            );
            errors += 1;
            continue;
        }

        let journal_id = ctx
            .db
            .account_move()
            .id()
            .find(&move_id)
            .map(|m| m.journal_id)
            .unwrap_or(0);
        let currency_id = parse_u64(col(&headers, row, "currency_id"));
        let debit = parse_f64(col(&headers, row, "debit"));
        let credit = parse_f64(col(&headers, row, "credit"));
        let date = opt_timestamp(col(&headers, row, "date")).unwrap_or(ctx.timestamp);

        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id,
            move_name: None,
            date,
            ref_: opt_str(col(&headers, row, "ref_")),
            parent_state: AccountMoveState::Draft,
            journal_id,
            company_id,
            company_currency_id: currency_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            name: col(&headers, row, "name").to_string(),
            quantity: parse_f64(col(&headers, row, "quantity")),
            price_unit: parse_f64(col(&headers, row, "price_unit")),
            price: parse_f64(col(&headers, row, "price_unit")),
            price_subtotal: 0.0,
            price_total: 0.0,
            discount: 0.0,
            balance: debit - credit,
            currency_id,
            amount_currency: 0.0,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            debit,
            credit,
            debit_currency: 0.0,
            credit_currency: 0.0,
            tax_base_amount: 0.0,
            account_id,
            account_internal_type: None,
            account_internal_group: None,
            account_root_id: None,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_ids: vec_u64(col(&headers, row, "tax_ids")),
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id: opt_u64(col(&headers, row, "partner_id")),
            commercial_partner_id: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            currency_id_field: None,
            blocked: false,
            matching_number: None,
            matching_label: None,
            is_matching: false,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            analytic_account_id: opt_u64(col(&headers, row, "analytic_account_id")),
            analytic_tag_ids: vec![],
            product_id: opt_u64(col(&headers, row, "product_id")),
            product_uom_id: opt_u64(col(&headers, row, "product_uom_id")),
            product_category_id: None,
            cogs_amount: parse_f64(col(&headers, row, "cogs_amount")),
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_move_line: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── CrossoveredBudget ─────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_budget_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "crossovered_budget",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let date_from = opt_timestamp(col(&headers, row, "date_from")).unwrap_or(ctx.timestamp);
        let date_to = opt_timestamp(col(&headers, row, "date_to")).unwrap_or(ctx.timestamp);

        ctx.db.crossovered_budget().insert(CrossoveredBudget {
            id: 0,
            name,
            description: opt_str(col(&headers, row, "description")),
            date_from,
            date_to,
            state: BudgetState::Draft,
            company_id,
            crossovered_budget_line: vec![],
            total_planned: 0.0,
            total_practical: 0.0,
            total_theoretical: 0.0,
            variance_percentage: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import crossovered_budget: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── CrossoveredBudgetLines ────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_budget_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget_lines", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "crossovered_budget_lines",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let general_budget_id = parse_u64(col(&headers, row, "general_budget_id"));

        if general_budget_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("general_budget_id"),
                None,
                "general_budget_id is required",
            );
            errors += 1;
            continue;
        }

        let date_from = opt_timestamp(col(&headers, row, "date_from")).unwrap_or(ctx.timestamp);
        let date_to = opt_timestamp(col(&headers, row, "date_to")).unwrap_or(ctx.timestamp);
        let planned_amount = parse_f64(col(&headers, row, "planned_amount"));

        ctx.db
            .crossovered_budget_lines()
            .insert(CrossoveredBudgetLines {
                id: 0,
                general_budget_id,
                analytic_account_id: opt_u64(col(&headers, row, "analytic_account_id")),
                date_from,
                date_to,
                paid_date: None,
                planned_amount,
                practical_amount: 0.0,
                theoretical_amount: 0.0,
                achieve_percentage: 0.0,
                company_id,
                is_above_budget: false,
                variance: 0.0,
                variance_percentage: 0.0,
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata: opt_str(col(&headers, row, "metadata")),
            });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import crossovered_budget_lines: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountAnalyticAccount ────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_analytic_account_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_account", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "account_analytic_account",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let currency_id = parse_u64(col(&headers, row, "currency_id"));

        ctx.db
            .account_analytic_account()
            .insert(AccountAnalyticAccount {
                id: 0,
                name,
                code: opt_str(col(&headers, row, "code")),
                active: true,
                company_id,
                partner_id: opt_u64(col(&headers, row, "partner_id")),
                group_id: opt_u64(col(&headers, row, "group_id")),
                line_ids: vec![],
                balance: 0.0,
                debit: 0.0,
                credit: 0.0,
                currency_id,
                root_plan_id: opt_u64(col(&headers, row, "root_plan_id")),
                plan_id: opt_u64(col(&headers, row, "plan_id")),
                root_id: None,
                is_required_in_move_lines: false,
                is_required_in_distribution: false,
                color: None,
                parent_id: opt_u64(col(&headers, row, "parent_id")),
                child_ids: vec![],
                message_follower_ids: vec![],
                activity_ids: vec![],
                message_ids: vec![],
                is_company_root: false,
                is_root_plan: false,
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata: opt_str(col(&headers, row, "metadata")),
            });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_analytic_account: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
