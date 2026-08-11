//! Inventory period close — snapshot quants, lock stock mutations, optional GL valuation.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::relations::{require_active_account, require_active_journal};
use crate::core::organization::company;
use crate::core::reference::require_active_currency_by_id;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::inventory::stock::stock_quant;
use crate::types::{AccountMoveState, PaymentState};
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = inventory_close,
    public,
    index(accessor = inventory_close_by_org, btree(columns = [organization_id])),
    index(accessor = inventory_close_by_company, btree(columns = [company_id])),
    index(accessor = inventory_close_by_state, btree(columns = [state]))
)]
pub struct InventoryClose {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub as_of: Timestamp,
    /// draft | closed
    pub state: String,
    /// When true, stock mutations for the company are blocked.
    pub locked: bool,
    pub line_count: u32,
    pub total_quantity: f64,
    pub total_value: f64,
    /// Optional GL posting accounts (set on create or overridden on run).
    pub journal_id: Option<u64>,
    pub inventory_account_id: Option<u64>,
    pub valuation_account_id: Option<u64>,
    /// Posted valuation move when GL accounts were supplied.
    pub account_move_id: Option<u64>,
    pub closed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = inventory_close_line,
    public,
    index(accessor = inventory_close_line_by_close, btree(columns = [close_id])),
    index(accessor = inventory_close_line_by_org, btree(columns = [organization_id]))
)]
pub struct InventoryCloseLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub close_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub quantity: f64,
    pub reserved_quantity: f64,
    pub available_quantity: f64,
    pub cost: f64,
    pub value: f64,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateInventoryCloseParams {
    pub name: String,
    pub as_of: Option<Timestamp>,
    pub journal_id: Option<u64>,
    pub inventory_account_id: Option<u64>,
    pub valuation_account_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RunInventoryCloseParams {
    /// Override create-time journal when posting valuation.
    pub journal_id: Option<u64>,
    pub inventory_account_id: Option<u64>,
    pub valuation_account_id: Option<u64>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Fail closed when the company has a locked inventory close.
pub(crate) fn assert_inventory_writable(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    let locked = ctx
        .db
        .inventory_close()
        .inventory_close_by_company()
        .filter(&company_id)
        .any(|c| c.organization_id == organization_id && c.state == "closed" && c.locked);
    if locked {
        return Err(
            "Inventory is locked by a closed inventory period — reopen before mutating stock"
                .to_string(),
        );
    }
    Ok(())
}

fn insert_valuation_line(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    move_name: &str,
    journal_id: u64,
    company_id: u64,
    currency_id: u64,
    account_id: u64,
    line_name: &str,
    debit: f64,
    credit: f64,
    sequence: u32,
) {
    ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id,
        move_id,
        move_name: Some(move_name.to_string()),
        date: ctx.timestamp,
        ref_: None,
        parent_state: AccountMoveState::Posted,
        journal_id,
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
        partner_id: None,
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
        metadata: None,
    });
}

/// Post balanced Entry: Dr inventory asset / Cr valuation clearing for close total_value.
fn post_close_valuation_move(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    close_id: u64,
    close_name: &str,
    as_of: Timestamp,
    total_value: f64,
    journal_id: u64,
    inventory_account_id: u64,
    valuation_account_id: u64,
) -> Result<u64, String> {
    let idempotency_key = format!("INV-CLOSE-{}", close_id);
    let fingerprint = format!("{organization_id}:{company_id}:{close_id}");
    if let Some(existing_id) = replayed_result(
        ctx,
        organization_id,
        company_id,
        "inventory_close_valuation",
        &idempotency_key,
        &fingerprint,
    )? {
        return Ok(existing_id);
    }

    if total_value.abs() < 1e-9 {
        return Err("total_value is zero — nothing to post".to_string());
    }
    if inventory_account_id == valuation_account_id {
        return Err("inventory_account_id and valuation_account_id must differ".to_string());
    }

    require_active_journal(
        ctx,
        organization_id,
        company_id,
        journal_id,
        "inventory close journal",
    )?;
    require_active_account(
        ctx,
        organization_id,
        company_id,
        inventory_account_id,
        "inventory account",
    )?;
    require_active_account(
        ctx,
        organization_id,
        company_id,
        valuation_account_id,
        "valuation account",
    )?;

    let amount = total_value.abs();
    let name = next_doc_number(ctx, "INVCLS");
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    if company.organization_id != organization_id {
        return Err("Company does not belong to this organization".to_string());
    }
    let currency_id = company.currency_id;
    require_active_currency_by_id(ctx, currency_id)?;
    let debit_inv = total_value >= 0.0;

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: Some(format!("Inventory close {close_id}: {close_name}")),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: as_of,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: None,
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: Some(format!("INVCLS-{close_id}")),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: if debit_inv { amount } else { -amount },
        amount_tax_signed: 0.0,
        amount_total_signed: if debit_inv { amount } else { -amount },
        amount_total_in_currency_signed: if debit_inv { amount } else { -amount },
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
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
        metadata: Some(
            serde_json::json!({
                "inventory_close_id": close_id,
                "total_value": total_value,
            })
            .to_string(),
        ),
    });

    if debit_inv {
        insert_valuation_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            journal_id,
            company_id,
            currency_id,
            inventory_account_id,
            "Inventory on-hand (close)",
            amount,
            0.0,
            1,
        );
        insert_valuation_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            journal_id,
            company_id,
            currency_id,
            valuation_account_id,
            "Inventory valuation (close)",
            0.0,
            amount,
            2,
        );
    } else {
        insert_valuation_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            journal_id,
            company_id,
            currency_id,
            valuation_account_id,
            "Inventory valuation (close)",
            amount,
            0.0,
            1,
        );
        insert_valuation_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            journal_id,
            company_id,
            currency_id,
            inventory_account_id,
            "Inventory on-hand (close)",
            0.0,
            amount,
            2,
        );
    }

    record_result(
        ctx,
        organization_id,
        company_id,
        "inventory_close_valuation",
        idempotency_key,
        fingerprint,
        "account_move",
        move_record.id,
    );

    Ok(move_record.id)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_inventory_close(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateInventoryCloseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;
    if params.name.trim().is_empty() {
        return Err("Close name cannot be empty".to_string());
    }
    let row = ctx.db.inventory_close().insert(InventoryClose {
        id: 0,
        organization_id,
        company_id,
        name: params.name.clone(),
        as_of: params.as_of.unwrap_or(ctx.timestamp),
        state: "draft".to_string(),
        locked: false,
        line_count: 0,
        total_quantity: 0.0,
        total_value: 0.0,
        journal_id: params.journal_id,
        inventory_account_id: params.inventory_account_id,
        valuation_account_id: params.valuation_account_id,
        account_move_id: None,
        closed_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_close",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": row.name, "state": row.state }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Snapshot company quants, lock stock mutations, optionally post valuation journal.
#[reducer]
pub fn run_inventory_close(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    close_id: u64,
    params: RunInventoryCloseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "update")?;
    let close = ctx
        .db
        .inventory_close()
        .id()
        .find(&close_id)
        .ok_or("Inventory close not found")?;
    if close.organization_id != organization_id || close.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if close.state != "draft" {
        return Err(format!(
            "Only draft closes can be run (state: {})",
            close.state
        ));
    }

    // Clear any prior lines (idempotent re-run of draft).
    let existing: Vec<u64> = ctx
        .db
        .inventory_close_line()
        .inventory_close_line_by_close()
        .filter(&close_id)
        .map(|l| l.id)
        .collect();
    for id in existing {
        ctx.db.inventory_close_line().id().delete(&id);
    }

    let mut line_count = 0u32;
    let mut total_quantity = 0.0;
    let mut total_value = 0.0;

    for quant in ctx
        .db
        .stock_quant()
        .quant_by_org()
        .filter(&organization_id)
        .filter(|q| q.company_id == company_id)
    {
        ctx.db.inventory_close_line().insert(InventoryCloseLine {
            id: 0,
            organization_id,
            company_id,
            close_id,
            product_id: quant.product_id,
            location_id: quant.location_id,
            lot_id: quant.lot_id,
            quantity: quant.quantity,
            reserved_quantity: quant.reserved_quantity,
            available_quantity: quant.available_quantity,
            cost: quant.cost,
            value: quant.value,
            metadata: None,
        });
        line_count = line_count.saturating_add(1);
        total_quantity += quant.quantity;
        total_value += quant.value;
    }

    let journal_id = params.journal_id.or(close.journal_id);
    let inventory_account_id = params.inventory_account_id.or(close.inventory_account_id);
    let valuation_account_id = params.valuation_account_id.or(close.valuation_account_id);

    let account_move_id = match (journal_id, inventory_account_id, valuation_account_id) {
        (Some(j), Some(inv), Some(val)) if total_value.abs() >= 1e-9 => {
            check_permission(ctx, organization_id, "account_move", "create")?;
            Some(post_close_valuation_move(
                ctx,
                organization_id,
                company_id,
                close_id,
                &close.name,
                close.as_of,
                total_value,
                j,
                inv,
                val,
            )?)
        }
        (Some(_), Some(_), Some(_)) => None, // zero value — skip GL
        (None, None, None) => None,
        _ => {
            return Err(
                "GL posting requires journal_id, inventory_account_id, and valuation_account_id together"
                    .to_string(),
            );
        }
    };

    let metadata = params.metadata.or(close.metadata.clone());

    ctx.db.inventory_close().id().update(InventoryClose {
        state: "closed".to_string(),
        locked: true,
        line_count,
        total_quantity,
        total_value,
        journal_id,
        inventory_account_id,
        valuation_account_id,
        account_move_id,
        closed_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata,
        ..close
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_close",
            record_id: close_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "closed",
                    "locked": true,
                    "line_count": line_count,
                    "total_value": total_value,
                    "account_move_id": account_move_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "locked".to_string(),
                "line_count".to_string(),
                "account_move_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn reopen_inventory_close(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    close_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "update")?;
    let close = ctx
        .db
        .inventory_close()
        .id()
        .find(&close_id)
        .ok_or("Inventory close not found")?;
    if close.organization_id != organization_id || close.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if close.state != "closed" {
        return Err("Only closed periods can be reopened".to_string());
    }
    if close.account_move_id.is_some() {
        return Err("Cannot reopen: GL valuation move exists — reverse it first through the accounting module".to_string());
    }

    ctx.db.inventory_close().id().update(InventoryClose {
        locked: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({
                "reopened_at": ctx.timestamp.to_micros_since_unix_epoch(),
                "prior": close.metadata,
                "account_move_id": close.account_move_id,
            })
            .to_string(),
        ),
        ..close
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_close",
            record_id: close_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "locked": true }).to_string()),
            new_values: Some(serde_json::json!({ "locked": false }).to_string()),
            changed_fields: vec!["locked".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
