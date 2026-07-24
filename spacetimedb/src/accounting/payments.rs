/// Payments — AccountPayment
///
/// Backs the `payment_ids` foreign key on BankReconciliationLine and POS transactions.
/// A payment is a cash/bank movement that settles one or more invoices or bills.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, reconcile_payment_with_invoice,
    AccountMove, AccountMoveLine, AddAccountMoveLineParams,
};
use crate::accounting::tax_management::account_tax;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{
    AccountMoveState, AccountTypeInternal, MoveType, PartnerType, PaymentState, PaymentType,
    TaxAmountType, TaxTypeUse,
};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

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

// ── Helpers ───────────────────────────────────────────────────────────────────

pub(crate) fn payment_line_params(
    account_id: u64,
    name: String,
    debit: f64,
    credit: f64,
    sequence: u32,
    partner_id: u64,
    payment_id: u64,
) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit,
        credit,
        sequence,
        quantity: 1.0,
        price_unit: debit.max(credit),
        discount: 0.0,
        tax_ids: vec![],
        partner_id: Some(partner_id),
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
        payment_id: Some(payment_id),
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

pub(crate) fn resolve_payment_liquidity_account(
    ctx: &ReducerContext,
    journal_id: u64,
) -> Result<u64, String> {
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Payment journal not found")?;
    journal
        .default_account_id
        .or(journal.bank_account_id)
        .ok_or_else(|| {
            "Payment journal missing default/bank liquidity account".to_string()
        })
}

pub(crate) fn resolve_payment_clearing_account(
    ctx: &ReducerContext,
    company_id: u64,
    payment_type: PaymentType,
) -> Result<(u64, &'static str), String> {
    let want = match payment_type {
        PaymentType::InBound => AccountTypeInternal::Receivable,
        PaymentType::OutBound => AccountTypeInternal::Payable,
    };
    let label = match want {
        AccountTypeInternal::Receivable => "receivable",
        AccountTypeInternal::Payable => "payable",
        _ => "clearing",
    };
    let account_id = ctx
        .db
        .account_account()
        .account_by_company()
        .filter(&company_id)
        .find(|a| !a.deprecated && a.internal_type.as_ref() == Some(&want))
        .map(|a| a.id)
        .ok_or_else(|| {
            format!("No active {label} account found for company {company_id}")
        })?;
    Ok((account_id, label))
}

/// Insert liquidity + AR/AP clearing lines on a draft payment move and mark it Posted.
/// Shared by `post_payment_impl` and operational `post_ledger_payment`.
pub(crate) fn insert_balanced_payment_lines_and_post(
    ctx: &ReducerContext,
    payment: &AccountPayment,
    mut move_record: AccountMove,
) -> Result<(AccountMove, u64, u64), String> {
    let amount = payment.amount;
    let payment_type = payment.payment_type.clone();
    let partner_id = payment.partner_id;
    let payment_id = payment.id;
    let liquidity_account_id = resolve_payment_liquidity_account(ctx, payment.journal_id)?;
    let (clearing_account_id, clearing_label) =
        resolve_payment_clearing_account(ctx, payment.company_id, payment_type.clone())?;

    let (bank_debit, bank_credit, clear_debit, clear_credit) = match payment_type {
        PaymentType::InBound => (amount, 0.0, 0.0, amount),
        PaymentType::OutBound => (0.0, amount, amount, 0.0),
    };

    insert_draft_account_move_line(
        ctx,
        &move_record,
        payment_line_params(
            liquidity_account_id,
            "Bank".to_string(),
            bank_debit,
            bank_credit,
            1,
            partner_id,
            payment_id,
        ),
    )?;
    let clearing_line = insert_draft_account_move_line(
        ctx,
        &move_record,
        payment_line_params(
            clearing_account_id,
            format!("Accounts {}", clearing_label),
            clear_debit,
            clear_credit,
            2,
            partner_id,
            payment_id,
        ),
    )?;
    // Explicit clearing label for reconcile (snake); residual must stay open until register.
    ctx.db.account_move_line().id().update(AccountMoveLine {
        account_internal_type: Some(clearing_label.to_string()),
        amount_residual: amount,
        amount_residual_currency: amount,
        ..clearing_line
    });

    for ml in ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
    {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Posted,
            ..ml
        });
    }
    move_record = ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        posted_before: true,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    Ok((move_record, liquidity_account_id, clearing_account_id))
}

fn assert_existing_payment_move_ready(
    ctx: &ReducerContext,
    payment: &AccountPayment,
    move_id: u64,
) -> Result<AccountMove, String> {
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Linked payment move not found")?;
    if move_record.organization_id != payment.organization_id {
        return Err("Linked payment move belongs to a different organization".to_string());
    }
    if move_record.company_id != payment.company_id {
        return Err("Linked payment move belongs to a different company".to_string());
    }
    if move_record.state != AccountMoveState::Posted {
        return Err("Linked payment move must be posted before marking payment Paid".to_string());
    }
    let line_count = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();
    if line_count < 2 {
        return Err(format!(
            "Linked payment move must have balanced lines, got {line_count}"
        ));
    }
    let debit: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .map(|l| l.debit)
        .sum();
    let credit: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .map(|l| l.credit)
        .sum();
    if (debit - credit).abs() > 0.01 {
        return Err(format!(
            "Linked payment move unbalanced: debit={debit} credit={credit}"
        ));
    }
    Ok(move_record)
}

/// Wave C WHT MVP: if outbound supplier payment and company has active pack WHT taxes,
/// record withhold amount on the payment journal move metadata (no full WHT certificate engine).
fn wht_metadata_for_vendor_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    payment: &AccountPayment,
) -> Option<String> {
    if payment.payment_type != PaymentType::OutBound
        || payment.partner_type != PartnerType::Supplier
    {
        return None;
    }

    let wht_tax = ctx.db.account_tax().iter().find(|t| {
        t.organization_id == organization_id
            && t.company_id == payment.company_id
            && t.active
            && t.type_tax_use == TaxTypeUse::Withholding
    })?;

    let rate = match wht_tax.amount_type {
        TaxAmountType::Percent => wht_tax.amount / 100.0,
        _ => wht_tax.amount,
    };
    if rate <= 0.0 {
        return None;
    }

    let withhold_amount = payment.amount * rate;
    let net_payable = payment.amount - withhold_amount;
    Some(
        serde_json::json!({
            "wht": {
                "tax_id": wht_tax.id,
                "tax_name": wht_tax.name,
                "rate": rate,
                "gross_amount": payment.amount,
                "withhold_amount": withhold_amount,
                "net_payable": net_payable,
                "note": "MVP: metadata only — no separate WHT liability journal lines yet"
            }
        })
        .to_string(),
    )
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
    post_payment_impl(ctx, organization_id, payment_id, false)
}

pub fn post_payment_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
    skip_approval_check: bool,
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

    if !skip_approval_check {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: payment.company_id,
                    action: GuardedActionKey::PostPayment,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::PostPayment { payment_id },
                    idempotency_key: format!("post-payment:{payment_id}"),
                    correlation_id: format!("account-payment:{payment_id}:post"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    ensure_accounting_period_open_for_date(ctx, payment.company_id, payment.date)?;

    if payment.amount <= 0.0 {
        return Err("Payment amount must be positive".to_string());
    }

    // Subscription (and similar) paths may pre-build a balanced move and link it
    // before calling this gate — mark Paid without creating a second journal header.
    if let Some(existing_move_id) = payment.move_id {
        let move_record = assert_existing_payment_move_ready(ctx, &payment, existing_move_id)?;
        let name = payment
            .name
            .clone()
            .unwrap_or_else(|| next_doc_number(ctx, "PAY"));
        ctx.db.account_payment().id().update(AccountPayment {
            name: Some(name),
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
                new_values: Some(
                    serde_json::json!({
                        "move_id": move_record.id,
                        "linked_existing_move": true,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["state".to_string(), "name".to_string()],
                metadata: None,
            },
        );
        return Ok(());
    }

    let name = next_doc_number(ctx, "PAY");
    let amount = payment.amount;
    let partner_id = payment.partner_id;
    let company_id = payment.company_id;
    let wht_metadata = wht_metadata_for_vendor_payment(ctx, organization_id, &payment);

    // Draft move first so line inserts stay consistent; mark Posted after balanced lines.
    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: payment.ref_.clone(),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Draft,
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
        partner_id: Some(partner_id),
        commercial_partner_id: Some(partner_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: payment.journal_id,
        currency_id: payment.currency_id,
        company_currency_id: payment.currency_id,
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
        metadata: wht_metadata,
    });

    let (move_record, liquidity_account_id, clearing_account_id) =
        insert_balanced_payment_lines_and_post(ctx, &payment, move_record)?;

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
            new_values: Some(
                serde_json::json!({
                    "move_id": move_record.id,
                    "liquidity_account_id": liquidity_account_id,
                    "clearing_account_id": clearing_account_id,
                })
                .to_string(),
            ),
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
    let old_state = format!("{:?}", payment.state);
    ctx.db.account_payment().id().update(AccountPayment {
        state: PaymentState::Reversed,
        ..payment
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(payment.company_id),
            table_name: "account_payment",
            record_id: payment_id,
            action: "CANCEL",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Reversed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
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

    let payment_move_id = payment
        .move_id
        .ok_or("Posted payment is missing linked journal move")?;

    // Company/org guard before mutating residuals or reconciled_* lists.
    for inv_id in &invoice_ids {
        let invoice = ctx
            .db
            .account_move()
            .id()
            .find(inv_id)
            .ok_or_else(|| format!("Invoice/bill move {inv_id} not found"))?;
        if invoice.organization_id != organization_id {
            return Err(format!(
                "Invoice/bill {inv_id} belongs to a different organization"
            ));
        }
        if invoice.company_id != payment.company_id {
            return Err(format!(
                "Invoice/bill {inv_id} belongs to a different company than the payment"
            ));
        }
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

    let company_id = payment.company_id;
    let old_invoice_ids = payment.reconciled_invoice_ids.clone();
    let old_bill_ids = payment.reconciled_bill_ids.clone();

    ctx.db.account_payment().id().update(AccountPayment {
        reconciled_invoice_ids: reconciled_invoice_ids.clone(),
        reconciled_bill_ids: reconciled_bill_ids.clone(),
        ..payment
    });

    // Settle residual in the same txn — register without reconcile left AR open.
    for inv_id in &invoice_ids {
        reconcile_payment_with_invoice(ctx, organization_id, payment_move_id, *inv_id)?;
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_payment",
            record_id: payment_id,
            action: "REGISTER_ON_INVOICE",
            old_values: Some(
                serde_json::json!({
                    "reconciled_invoice_ids": old_invoice_ids,
                    "reconciled_bill_ids": old_bill_ids,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "reconciled_invoice_ids": reconciled_invoice_ids,
                    "reconciled_bill_ids": reconciled_bill_ids,
                    "invoice_ids": invoice_ids,
                    "is_bill": is_bill,
                    "settled": true,
                })
                .to_string(),
            ),
            changed_fields: if is_bill {
                vec!["reconciled_bill_ids".to_string()]
            } else {
                vec!["reconciled_invoice_ids".to_string()]
            },
            metadata: None,
        },
    );
    Ok(())
}
