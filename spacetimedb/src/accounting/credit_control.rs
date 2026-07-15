/// Partner credit control — credit limits, payment holds, bad-debt write-offs.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{account_move, account_move_line, AccountMove, AccountMoveLine};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountMoveState, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = partner_credit_control,
    public,
    index(accessor = partner_credit_by_org, btree(columns = [organization_id])),
    index(accessor = partner_credit_by_company, btree(columns = [company_id])),
    index(accessor = partner_credit_by_partner, btree(columns = [partner_id]))
)]
pub struct PartnerCreditControl {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub partner_id: u64,
    pub credit_limit: f64,
    pub payment_hold: bool,
    pub notes: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertPartnerCreditControlParams {
    pub partner_id: u64,
    pub credit_limit: f64,
    pub payment_hold: bool,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBadDebtWriteOffParams {
    pub partner_id: u64,
    pub move_id: u64,
    pub amount: f64,
    pub journal_id: u64,
    pub receivable_account_id: u64,
    pub write_off_account_id: u64,
    pub date: Timestamp,
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Reject invoice posting when partner is on payment hold or would exceed credit limit.
pub fn ensure_partner_credit_allows_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    partner_id: Option<u64>,
    invoice_total: f64,
) -> Result<(), String> {
    let Some(partner_id) = partner_id else {
        return Ok(());
    };

    let Some(ctrl) = ctx
        .db
        .partner_credit_control()
        .partner_credit_by_partner()
        .filter(&partner_id)
        .find(|c| c.organization_id == organization_id && c.company_id == company_id)
    else {
        return Ok(());
    };

    if ctrl.payment_hold {
        return Err("Partner is on payment hold; cannot post invoice".to_string());
    }

    if ctrl.credit_limit <= 0.0 {
        return Ok(());
    }

    let mut open_ar = 0.0;
    for mv in ctx.db.account_move().iter() {
        if mv.organization_id != organization_id
            || mv.company_id != company_id
            || mv.partner_id != Some(partner_id)
            || mv.state != AccountMoveState::Posted
        {
            continue;
        }
        if matches!(
            mv.move_type,
            crate::types::MoveType::OutInvoice | crate::types::MoveType::OutRefund
        ) {
            open_ar += mv.amount_residual;
        }
    }

    if open_ar + invoice_total > ctrl.credit_limit + 0.01 {
        return Err(format!(
            "Invoice would exceed partner credit limit ({}); open AR {}",
            ctrl.credit_limit, open_ar
        ));
    }

    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn upsert_partner_credit_control(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: UpsertPartnerCreditControlParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "partner_credit_control", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.credit_limit < 0.0 {
        return Err("credit_limit cannot be negative".to_string());
    }

    let existing = ctx
        .db
        .partner_credit_control()
        .partner_credit_by_partner()
        .filter(&params.partner_id)
        .find(|c| c.organization_id == organization_id && c.company_id == company_id);

    let record_id = if let Some(row) = existing {
        let id = row.id;
        ctx.db.partner_credit_control().id().update(PartnerCreditControl {
            credit_limit: params.credit_limit,
            payment_hold: params.payment_hold,
            notes: params.notes.clone(),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata.clone(),
            ..row
        });
        id
    } else {
        ctx.db
            .partner_credit_control()
            .insert(PartnerCreditControl {
                id: 0,
                organization_id,
                company_id,
                partner_id: params.partner_id,
                credit_limit: params.credit_limit,
                payment_hold: params.payment_hold,
                notes: params.notes.clone(),
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata: params.metadata.clone(),
            })
            .id
    };

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "partner_credit_control",
            record_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "partner_id": params.partner_id,
                    "credit_limit": params.credit_limit,
                    "payment_hold": params.payment_hold,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "credit_limit".to_string(),
                "payment_hold".to_string(),
            ],
            metadata: params.metadata.clone(),
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_bad_debt_write_off(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateBadDebtWriteOffParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    ensure_accounting_period_open_for_date(ctx, company_id, params.date)?;

    if params.amount <= 0.0 {
        return Err("Write-off amount must be positive".to_string());
    }

    let source = ctx
        .db
        .account_move()
        .id()
        .find(&params.move_id)
        .ok_or("Source move not found")?;
    if source.organization_id != organization_id || source.company_id != company_id {
        return Err("Source move does not belong to this company".to_string());
    }
    if source.state != AccountMoveState::Posted {
        return Err("Source move must be posted".to_string());
    }
    if params.amount > source.amount_residual + 0.01 {
        return Err("Write-off amount exceeds residual".to_string());
    }

    let name = next_doc_number(ctx, "BDEBT");
    let currency_id = source.currency_id;
    let amount = params.amount;

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: params.reference.clone(),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: params.date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("write-off:{}", params.move_id)),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: params.reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(params.partner_id),
        commercial_partner_id: Some(params.partner_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: amount,
        amount_tax_signed: 0.0,
        amount_total_signed: amount,
        amount_total_in_currency_signed: amount,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::Paid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });

    let insert_line = |account_id: u64, line_name: &str, debit: f64, credit: f64, sequence: u32| {
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id: move_record.id,
            move_name: Some(name.clone()),
            date: params.date,
            ref_: params.reference.clone(),
            parent_state: AccountMoveState::Posted,
            journal_id: params.journal_id,
            company_id,
            company_currency_id: currency_id,
            sequence,
            name: line_name.to_string(),
            quantity: 0.0,
            price_unit: 0.0,
            price: 0.0,
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
            tax_ids: vec![],
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id: Some(params.partner_id),
            commercial_partner_id: Some(params.partner_id),
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
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            cogs_amount: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata.clone(),
        });
    };

    insert_line(
        params.write_off_account_id,
        "Bad debt expense",
        amount,
        0.0,
        1,
    );
    insert_line(
        params.receivable_account_id,
        "AR write-off",
        0.0,
        amount,
        2,
    );

    ctx.db.account_move().id().update(AccountMove {
        amount_residual: (source.amount_residual - amount).max(0.0),
        amount_residual_signed: (source.amount_residual_signed - amount),
        payment_state: if source.amount_residual - amount <= 0.01 {
            PaymentState::Paid
        } else {
            PaymentState::Partial
        },
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..source
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "write_off_of": params.move_id,
                    "amount": amount,
                    "partner_id": params.partner_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["amount".to_string()],
            metadata: params.metadata.clone(),
        },
    );

    Ok(())
}
