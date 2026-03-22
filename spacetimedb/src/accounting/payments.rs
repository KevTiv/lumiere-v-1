/// Payments — AccountPayment
///
/// Backs the `payment_ids` foreign key on BankReconciliationLine and POS transactions.
/// A payment is a cash/bank movement that settles one or more invoices or bills.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{account_move, AccountMove};
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountMoveState, MoveType, PartnerType, PaymentState, PaymentType};

// ── Table ─────────────────────────────────────────────────────────────────────

/// Account Payment — A single payment registered against invoices or bills.
/// On posting, a corresponding AccountMove (journal entry) is automatically created.
#[spacetimedb::table(
    accessor = account_payment,
    public,
    index(accessor = payment_by_org, btree(columns = [organization_id])),
    index(accessor = payment_by_partner, btree(columns = [partner_id])),
    index(accessor = payment_by_state, btree(columns = [state]))
)]
pub struct AccountPayment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: Option<String>,      // "PAY-0001" — set on post
    pub move_id: Option<u64>,      // Linked AccountMove (set on post)
    pub payment_type: PaymentType, // InBound (customer pays) | OutBound (we pay supplier)
    pub partner_type: PartnerType, // Customer | Supplier
    pub partner_id: u64,
    pub amount: f64,
    pub currency_id: u64,
    pub date: Timestamp,
    pub journal_id: u64,
    pub ref_: Option<String>,             // Internal reference
    pub memo: Option<String>,             // Communication shown on bank statement
    pub reconciled_invoice_ids: Vec<u64>, // Invoices settled by this payment
    pub reconciled_bill_ids: Vec<u64>,    // Bills settled by this payment
    pub state: PaymentState,              // NotPaid (Draft) | Paid (Posted) | Reversed (Cancelled)
    pub created_at: Timestamp,
    pub create_uid: Identity,
}

// ── Params ────────────────────────────────────────────────────────────────────

#[derive(SpacetimeType)]
pub struct CreatePaymentParams {
    pub company_id: u64,
    pub payment_type: PaymentType,
    pub partner_type: PartnerType,
    pub partner_id: u64,
    pub amount: f64,
    pub currency_id: u64,
    pub date: Option<Timestamp>,
    pub journal_id: u64,
    pub ref_: Option<String>,
    pub memo: Option<String>,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Create a payment in Draft state.
/// Call `post_payment` to confirm it and generate the journal entry.
#[reducer]
pub fn create_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePaymentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment", "create")?;
    if params.amount <= 0.0 {
        return Err("Payment amount must be positive".to_string());
    }
    let payment = ctx.db.account_payment().insert(AccountPayment {
        id: 0,
        organization_id,
        company_id: params.company_id,
        name: None,
        move_id: None,
        payment_type: params.payment_type,
        partner_type: params.partner_type,
        partner_id: params.partner_id,
        amount: params.amount,
        currency_id: params.currency_id,
        date: params.date.unwrap_or(ctx.timestamp),
        journal_id: params.journal_id,
        ref_: params.ref_,
        memo: params.memo,
        reconciled_invoice_ids: vec![],
        reconciled_bill_ids: vec![],
        state: PaymentState::NotPaid,
        created_at: ctx.timestamp,
        create_uid: ctx.sender(),
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "account_payment",
            record_id: payment.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Post (confirm) a payment.
/// Generates a document number and creates the corresponding AccountMove journal entry.
#[reducer]
pub fn post_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment", "post")?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found")?;
    if payment.organization_id != organization_id {
        return Err("Payment belongs to a different organization".to_string());
    }
    if payment.state != PaymentState::NotPaid {
        return Err("Payment is not in draft state".to_string());
    }

    // Generate document number
    let name = next_doc_number(ctx, "PAY");

    // Determine move_type from payment direction
    let move_type = match payment.payment_type {
        PaymentType::InBound => MoveType::Entry,
        PaymentType::OutBound => MoveType::Entry,
    };

    // Create a corresponding journal entry (AccountMove)
    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: payment.ref_.clone(),
        move_type,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: payment.date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: None,
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: payment.memo.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(payment.partner_id),
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id: payment.company_id,
        journal_id: payment.journal_id,
        currency_id: payment.currency_id,
        company_currency_id: payment.currency_id,
        amount_untaxed: payment.amount,
        amount_tax: 0.0,
        amount_total: payment.amount,
        amount_residual: payment.amount,
        amount_untaxed_signed: payment.amount,
        amount_tax_signed: 0.0,
        amount_total_signed: payment.amount,
        amount_total_in_currency_signed: payment.amount,
        amount_residual_signed: payment.amount,
        to_check: false,
        posted_before: false,
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
        metadata: None,
    });

    // Update payment to Posted
    ctx.db.account_payment().id().update(AccountPayment {
        name: Some(name),
        move_id: Some(move_record.id),
        state: PaymentState::Paid,
        ..payment
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(move_record.company_id),
            table_name: "account_payment",
            record_id: payment_id,
            action: "POST",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "state".to_string(),
                "name".to_string(),
                "move_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

/// Cancel a posted payment. Sets state to Reversed.
#[reducer]
pub fn cancel_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment", "cancel")?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found")?;
    if payment.organization_id != organization_id {
        return Err("Payment belongs to a different organization".to_string());
    }
    if payment.state == PaymentState::Reversed {
        return Err("Payment is already cancelled".to_string());
    }
    ctx.db.account_payment().id().update(AccountPayment {
        state: PaymentState::Reversed,
        ..payment
    });
    Ok(())
}

/// Reconcile a payment with one or more invoices.
/// Appends invoice IDs to reconciled_invoice_ids or reconciled_bill_ids.
#[reducer]
pub fn register_payment_on_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
    invoice_ids: Vec<u64>,
    is_bill: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment", "reconcile")?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found")?;
    if payment.organization_id != organization_id {
        return Err("Payment belongs to a different organization".to_string());
    }
    if payment.state != PaymentState::Paid {
        return Err("Only posted payments can be reconciled".to_string());
    }

    let mut reconciled_invoice_ids = payment.reconciled_invoice_ids.clone();
    let mut reconciled_bill_ids = payment.reconciled_bill_ids.clone();

    for inv_id in &invoice_ids {
        if is_bill {
            if !reconciled_bill_ids.contains(inv_id) {
                reconciled_bill_ids.push(*inv_id);
            }
        } else if !reconciled_invoice_ids.contains(inv_id) {
            reconciled_invoice_ids.push(*inv_id);
        }
    }

    ctx.db.account_payment().id().update(AccountPayment {
        reconciled_invoice_ids,
        reconciled_bill_ids,
        ..payment
    });
    Ok(())
}
