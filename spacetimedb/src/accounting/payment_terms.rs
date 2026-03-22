/// Payment Terms — AccountPaymentTerm & AccountPaymentTermLine
///
/// Backs the `payment_term_id` foreign key on SaleOrder, PurchaseOrder, and AccountMove.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::PaymentTermValue;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Payment Term — Defines how a payment is split over time (e.g. "30 days net", "50% now 50% in 30 days").
#[spacetimedb::table(
    accessor = account_payment_term,
    public,
    index(accessor = payment_term_by_org, btree(columns = [organization_id]))
)]
pub struct AccountPaymentTerm {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub note: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// Payment Term Line — One installment within a payment term.
/// A term like "50% now, 50% in 30 days" has two lines.
#[spacetimedb::table(
    accessor = account_payment_term_line,
    public,
    index(accessor = payment_term_line_by_term, btree(columns = [payment_term_id]))
)]
pub struct AccountPaymentTermLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub payment_term_id: u64,          // FK → AccountPaymentTerm
    pub value: PaymentTermValue,       // Balance | Percent | Fixed
    pub value_amount: f64, // 0.0 for Balance, percentage for Percent, fixed amount for Fixed
    pub days: u32,         // Days from invoice date
    pub months: u32,       // Months from invoice date (added to days)
    pub days_after_end_of_month: bool, // Compute from end of month instead of invoice date
    pub sequence: u32,     // Display/processing order
}

// ── Params ────────────────────────────────────────────────────────────────────

#[derive(SpacetimeType)]
pub struct CreatePaymentTermParams {
    pub name: String,
    pub note: Option<String>,
}

#[derive(SpacetimeType)]
pub struct CreatePaymentTermLineParams {
    pub payment_term_id: u64,
    pub value: PaymentTermValue,
    pub value_amount: f64,
    pub days: u32,
    pub months: u32,
    pub days_after_end_of_month: bool,
    pub sequence: u32,
}

// ── Reducers: Payment Terms ───────────────────────────────────────────────────

#[reducer]
pub fn create_payment_term(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePaymentTermParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_term", "create")?;
    if params.name.is_empty() {
        return Err("Payment term name cannot be empty".to_string());
    }
    let term = ctx.db.account_payment_term().insert(AccountPaymentTerm {
        id: 0,
        organization_id,
        name: params.name,
        note: params.note,
        is_active: true,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "account_payment_term",
            record_id: term.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_payment_term(
    ctx: &ReducerContext,
    organization_id: u64,
    term_id: u64,
    name: Option<String>,
    note: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_term", "update")?;
    let term = ctx
        .db
        .account_payment_term()
        .id()
        .find(&term_id)
        .ok_or("Payment term not found")?;
    if term.organization_id != organization_id {
        return Err("Payment term belongs to a different organization".to_string());
    }
    ctx.db
        .account_payment_term()
        .id()
        .update(AccountPaymentTerm {
            name: name.unwrap_or(term.name.clone()),
            note: note.or(term.note.clone()),
            is_active: is_active.unwrap_or(term.is_active),
            ..term
        });
    Ok(())
}

#[reducer]
pub fn delete_payment_term(
    ctx: &ReducerContext,
    organization_id: u64,
    term_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_term", "delete")?;
    let term = ctx
        .db
        .account_payment_term()
        .id()
        .find(&term_id)
        .ok_or("Payment term not found")?;
    if term.organization_id != organization_id {
        return Err("Payment term belongs to a different organization".to_string());
    }
    ctx.db.account_payment_term().id().delete(&term_id);
    // Cascade: delete all lines
    let line_ids: Vec<u64> = ctx
        .db
        .account_payment_term_line()
        .payment_term_line_by_term()
        .filter(&term_id)
        .map(|l| l.id)
        .collect();
    for lid in line_ids {
        ctx.db.account_payment_term_line().id().delete(&lid);
    }
    Ok(())
}

// ── Reducers: Payment Term Lines ──────────────────────────────────────────────

#[reducer]
pub fn create_payment_term_line(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePaymentTermLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_term", "update")?;
    // Verify the term exists and belongs to this org
    let term = ctx
        .db
        .account_payment_term()
        .id()
        .find(&params.payment_term_id)
        .ok_or("Payment term not found")?;
    if term.organization_id != organization_id {
        return Err("Payment term belongs to a different organization".to_string());
    }
    ctx.db
        .account_payment_term_line()
        .insert(AccountPaymentTermLine {
            id: 0,
            payment_term_id: params.payment_term_id,
            value: params.value,
            value_amount: params.value_amount,
            days: params.days,
            months: params.months,
            days_after_end_of_month: params.days_after_end_of_month,
            sequence: params.sequence,
        });
    Ok(())
}

#[reducer]
pub fn update_payment_term_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    value: Option<PaymentTermValue>,
    value_amount: Option<f64>,
    days: Option<u32>,
    months: Option<u32>,
    days_after_end_of_month: Option<bool>,
    sequence: Option<u32>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_term", "update")?;
    let line = ctx
        .db
        .account_payment_term_line()
        .id()
        .find(&line_id)
        .ok_or("Payment term line not found")?;
    // Verify org ownership via parent term
    let term = ctx
        .db
        .account_payment_term()
        .id()
        .find(&line.payment_term_id)
        .ok_or("Parent payment term not found")?;
    if term.organization_id != organization_id {
        return Err("Payment term belongs to a different organization".to_string());
    }
    ctx.db
        .account_payment_term_line()
        .id()
        .update(AccountPaymentTermLine {
            value: value.unwrap_or(line.value.clone()),
            value_amount: value_amount.unwrap_or(line.value_amount),
            days: days.unwrap_or(line.days),
            months: months.unwrap_or(line.months),
            days_after_end_of_month: days_after_end_of_month
                .unwrap_or(line.days_after_end_of_month),
            sequence: sequence.unwrap_or(line.sequence),
            ..line
        });
    Ok(())
}

#[reducer]
pub fn delete_payment_term_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_term", "update")?;
    let line = ctx
        .db
        .account_payment_term_line()
        .id()
        .find(&line_id)
        .ok_or("Payment term line not found")?;
    let term = ctx
        .db
        .account_payment_term()
        .id()
        .find(&line.payment_term_id)
        .ok_or("Parent payment term not found")?;
    if term.organization_id != organization_id {
        return Err("Payment term belongs to a different organization".to_string());
    }
    ctx.db.account_payment_term_line().id().delete(&line_id);
    Ok(())
}
