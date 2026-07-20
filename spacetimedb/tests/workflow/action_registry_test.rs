//! Guarded action registry contract and replay tests.

use sha2::{Digest, Sha256};
use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{account_period, AccountPeriod};
use crate::accounting::journal_entries::{
    account_move, add_account_move_line, AccountMove, AddAccountMoveLineParams,
};
use crate::accounting::payments::{account_payment, AccountPayment};
use crate::purchasing::purchase_orders::{purchase_order, PurchaseOrder};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountMoveState, MoveType, PartnerType, PaymentState, PaymentType, PeriodState,
    PoInvoiceStatus, PoState,
};
use crate::workflow::action_registry::{
    execute_guarded_action, guarded_action_receipt, resolve_guarded_action,
    snapshot_guarded_action, ExecuteGuardedActionParams, GuardedActionInput, GuardedActionKey,
    GuardedActionReceipt, GuardedActionSnapshot, GuardedActionSubjectKind,
    GUARDED_ACTION_SCHEMA_VERSION,
};

const REVISION_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVISION_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

pub fn test_guarded_action_registry(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    rejects_unregistered_keys_and_versions()?;
    replays_all_seven_actions_and_rejects_changed_revision(ctx)?;
    executes_payment_and_order_once(ctx)?;
    rejects_unbalanced_locked_and_cross_company_actions(ctx)?;
    Ok(())
}

fn rejects_unregistered_keys_and_versions() -> Result<(), String> {
    let registered = [
        "confirm_purchase_order",
        "send_purchase_order",
        "confirm_sales_order",
        "post_account_move",
        "post_payment",
        "approve_expense_sheet",
        "approve_ai_action_draft",
    ];
    for key in registered {
        resolve_guarded_action(key, GUARDED_ACTION_SCHEMA_VERSION)?;
    }
    for key in [
        "approve_leave",
        "post_payment_transaction",
        "reverse_payment_transaction",
        "arbitrary_reducer",
    ] {
        if resolve_guarded_action(key, GUARDED_ACTION_SCHEMA_VERSION).is_ok() {
            return Err(format!(
                "unregistered action '{key}' entered the closed registry"
            ));
        }
    }
    if resolve_guarded_action("post_payment", GUARDED_ACTION_SCHEMA_VERSION + 1).is_ok() {
        return Err("unsupported action schema version was accepted".to_string());
    }
    Ok(())
}

fn replays_all_seven_actions_and_rejects_changed_revision(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let cases = [
        (
            GuardedActionKey::ConfirmPurchaseOrder,
            GuardedActionInput::ConfirmPurchaseOrder { order_id: 910_001 },
            GuardedActionSubjectKind::PurchaseOrder,
            910_001,
        ),
        (
            GuardedActionKey::SendPurchaseOrder,
            GuardedActionInput::SendPurchaseOrder { order_id: 910_002 },
            GuardedActionSubjectKind::PurchaseOrder,
            910_002,
        ),
        (
            GuardedActionKey::ConfirmSalesOrder,
            GuardedActionInput::ConfirmSalesOrder { order_id: 910_003 },
            GuardedActionSubjectKind::SalesOrder,
            910_003,
        ),
        (
            GuardedActionKey::PostAccountMove,
            GuardedActionInput::PostAccountMove { move_id: 910_004 },
            GuardedActionSubjectKind::AccountMove,
            910_004,
        ),
        (
            GuardedActionKey::PostPayment,
            GuardedActionInput::PostPayment {
                payment_id: 910_005,
            },
            GuardedActionSubjectKind::AccountPayment,
            910_005,
        ),
        (
            GuardedActionKey::ApproveExpenseSheet,
            GuardedActionInput::ApproveExpenseSheet { sheet_id: 910_006 },
            GuardedActionSubjectKind::ExpenseSheet,
            910_006,
        ),
        (
            GuardedActionKey::ApproveAiActionDraft,
            GuardedActionInput::ApproveAiActionDraft { draft_id: 910_007 },
            GuardedActionSubjectKind::AiActionDraft,
            910_007,
        ),
    ];

    for (index, (action, input, subject_kind, subject_id)) in cases.into_iter().enumerate() {
        let organization_id = 900_000 + index as u64;
        let company_id = 905_000 + index as u64;
        let idempotency_key = format!(
            "action-registry-replay-{}-{index}",
            ctx.timestamp.to_micros_since_unix_epoch()
        );
        let input_hash = input_hash(&action, subject_id);
        let invocation_hash = invocation_hash(
            organization_id,
            company_id,
            &subject_kind,
            subject_id,
            &action,
            &input_hash,
            REVISION_A,
        );
        let receipt_id = receipt_id(organization_id, company_id, &idempotency_key);
        let result_revision = canonical_hash(&["result", action.as_str()]);
        let effect_hash = canonical_hash(&[&invocation_hash, &result_revision]);
        ctx.db
            .guarded_action_receipt()
            .insert(GuardedActionReceipt {
                id: receipt_id.clone(),
                organization_id,
                company_id,
                subject_kind,
                subject_id,
                action: action.clone(),
                action_version: GUARDED_ACTION_SCHEMA_VERSION,
                input_hash,
                expected_subject_revision_hash: REVISION_A.to_string(),
                result_subject_revision_hash: result_revision.clone(),
                invocation_hash,
                effect_hash: effect_hash.clone(),
                idempotency_key: idempotency_key.clone(),
                executed_at: ctx.timestamp,
            });

        let replay = execute_guarded_action(
            ctx,
            ExecuteGuardedActionParams {
                organization_id,
                company_id,
                action: action.clone(),
                action_version: GUARDED_ACTION_SCHEMA_VERSION,
                input: input.clone(),
                expected_subject_revision_hash: REVISION_A.to_string(),
                idempotency_key: idempotency_key.clone(),
            },
        )?;
        if !replay.replayed
            || replay.receipt_id != receipt_id
            || replay.effect_hash != effect_hash
            || replay.result_subject_revision_hash != result_revision
        {
            return Err(format!(
                "{} did not return its original execution receipt",
                action.as_str()
            ));
        }

        let changed = execute_guarded_action(
            ctx,
            ExecuteGuardedActionParams {
                organization_id,
                company_id,
                action,
                action_version: GUARDED_ACTION_SCHEMA_VERSION,
                input,
                expected_subject_revision_hash: REVISION_B.to_string(),
                idempotency_key,
            },
        )
        .err()
        .ok_or("changed revision reused a guarded action idempotency key")?;
        if !changed.contains("different input or revision") {
            return Err(format!("unexpected changed-revision error: {changed}"));
        }
    }
    Ok(())
}

fn executes_payment_and_order_once(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let payment = ctx.db.account_payment().insert(AccountPayment {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        name: None,
        move_id: None,
        payment_type: PaymentType::InBound,
        partner_type: PartnerType::Customer,
        partner_id: fixture.partner_id,
        amount: 12.34,
        currency_id: 1,
        date: ctx.timestamp,
        journal_id: 991_001,
        ref_: Some("workflow action test".to_string()),
        memo: None,
        reconciled_invoice_ids: vec![],
        reconciled_bill_ids: vec![],
        state: PaymentState::NotPaid,
        created_at: ctx.timestamp,
        create_uid: ctx.sender(),
    });
    let payment_action = GuardedActionKey::PostPayment;
    let payment_input = GuardedActionInput::PostPayment {
        payment_id: payment.id,
    };
    let payment_snapshot = snapshot_guarded_action(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        payment_action.clone(),
        GUARDED_ACTION_SCHEMA_VERSION,
        payment_input.clone(),
    )?;
    let payment_params = execution_params(
        &payment_snapshot,
        payment_action,
        payment_input,
        "real-payment-post",
    );
    let first = execute_guarded_action(ctx, payment_params.clone())?;
    let posted = ctx
        .db
        .account_payment()
        .id()
        .find(&payment.id)
        .ok_or("posted payment missing")?;
    if posted.state != PaymentState::Paid || posted.move_id.is_none() || first.replayed {
        return Err("payment adapter did not post exactly once".to_string());
    }
    let move_id = posted.move_id;
    let replay = execute_guarded_action(ctx, payment_params)?;
    let replayed_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment.id)
        .ok_or("replayed payment missing")?;
    if !replay.replayed
        || replay.receipt_id != first.receipt_id
        || replayed_payment.move_id != move_id
    {
        return Err("payment replay created a second accounting effect".to_string());
    }

    let order = insert_draft_purchase_order(ctx, &fixture);
    let order_action = GuardedActionKey::SendPurchaseOrder;
    let order_input = GuardedActionInput::SendPurchaseOrder { order_id: order.id };
    let order_snapshot = snapshot_guarded_action(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        order_action.clone(),
        GUARDED_ACTION_SCHEMA_VERSION,
        order_input.clone(),
    )?;
    let order_params = execution_params(
        &order_snapshot,
        order_action,
        order_input,
        "real-purchase-send",
    );
    let first = execute_guarded_action(ctx, order_params.clone())?;
    let sent = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("sent purchase order missing")?;
    if sent.state != PoState::Sent || first.replayed {
        return Err("purchase-order adapter did not send exactly once".to_string());
    }
    let replay = execute_guarded_action(ctx, order_params)?;
    if !replay.replayed || replay.receipt_id != first.receipt_id {
        return Err("purchase-order replay did not return the original receipt".to_string());
    }
    Ok(())
}

fn rejects_unbalanced_locked_and_cross_company_actions(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let unbalanced = insert_draft_move(ctx, &fixture, "WF-UNBALANCED");
    add_test_move_line(ctx, &fixture, unbalanced.id, 10.0, 0.0, 1)?;
    let action = GuardedActionKey::PostAccountMove;
    let input = GuardedActionInput::PostAccountMove {
        move_id: unbalanced.id,
    };
    let snapshot = snapshot_guarded_action(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        action.clone(),
        GUARDED_ACTION_SCHEMA_VERSION,
        input.clone(),
    )?;
    let receipt_count = ctx.db.guarded_action_receipt().iter().count();
    let error = execute_guarded_action(
        ctx,
        execution_params(&snapshot, action.clone(), input.clone(), "unbalanced-move"),
    )
    .err()
    .ok_or("unbalanced journal move was posted")?;
    if !error.contains("not balanced")
        || ctx
            .db
            .account_move()
            .id()
            .find(&unbalanced.id)
            .ok_or("unbalanced move missing")?
            .state
            != AccountMoveState::Draft
        || ctx.db.guarded_action_receipt().iter().count() != receipt_count
    {
        return Err(format!(
            "unbalanced action did not roll back cleanly: {error}"
        ));
    }

    let other = OrgFixture::seed_minimal(ctx)?;
    let cross_company = snapshot_guarded_action(
        ctx,
        fixture.organization_id,
        other.company_id,
        action.clone(),
        GUARDED_ACTION_SCHEMA_VERSION,
        input,
    )
    .err()
    .ok_or("cross-company journal snapshot was accepted")?;
    if !cross_company.contains("does not belong to this organization")
        && !cross_company.contains("different company")
    {
        return Err(format!("unexpected cross-company error: {cross_company}"));
    }

    let locked = insert_draft_move(ctx, &fixture, "WF-LOCKED");
    add_test_move_line(ctx, &fixture, locked.id, 10.0, 10.0, 1)?;
    let locked_input = GuardedActionInput::PostAccountMove { move_id: locked.id };
    let locked_snapshot = snapshot_guarded_action(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        action.clone(),
        GUARDED_ACTION_SCHEMA_VERSION,
        locked_input.clone(),
    )?;
    let period = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&fixture.company_id)
        .find(|period| period.state == PeriodState::Open)
        .ok_or("open test accounting period missing")?;
    ctx.db.account_period().id().update(AccountPeriod {
        state: PeriodState::Closed,
        ..period
    });
    let error = execute_guarded_action(
        ctx,
        execution_params(&locked_snapshot, action, locked_input, "locked-move"),
    )
    .err()
    .ok_or("move in a closed period was posted")?;
    if !error.contains("closed")
        || ctx
            .db
            .account_move()
            .id()
            .find(&locked.id)
            .ok_or("locked move missing")?
            .state
            != AccountMoveState::Draft
        || ctx.db.guarded_action_receipt().iter().count() != receipt_count
    {
        return Err(format!(
            "locked-period action did not roll back cleanly: {error}"
        ));
    }
    Ok(())
}

fn execution_params(
    snapshot: &GuardedActionSnapshot,
    action: GuardedActionKey,
    input: GuardedActionInput,
    idempotency_key: &str,
) -> ExecuteGuardedActionParams {
    ExecuteGuardedActionParams {
        organization_id: snapshot.organization_id,
        company_id: snapshot.company_id,
        action,
        action_version: GUARDED_ACTION_SCHEMA_VERSION,
        input,
        expected_subject_revision_hash: snapshot.subject_revision_hash.clone(),
        idempotency_key: idempotency_key.to_string(),
    }
}

fn insert_draft_purchase_order(ctx: &ReducerContext, fixture: &OrgFixture) -> PurchaseOrder {
    ctx.db.purchase_order().insert(PurchaseOrder {
        id: 0,
        organization_id: fixture.organization_id,
        name: Some("WF-PO".to_string()),
        origin: None,
        partner_ref: None,
        state: PoState::Draft,
        date_order: ctx.timestamp,
        date_approve: None,
        partner_id: fixture.partner_id,
        dest_address_id: None,
        currency_id: 1,
        payment_term_id: None,
        fiscal_position_id: None,
        date_planned: None,
        date_calendar_start: None,
        date_calendar_done: None,
        company_id: fixture.company_id,
        user_id: ctx.sender(),
        invoice_count: 0,
        invoice_ids: vec![],
        invoice_status: PoInvoiceStatus::No,
        picking_count: 0,
        picking_ids: vec![],
        effective_date: None,
        amount_untaxed: 25.0,
        amount_tax: 0.0,
        amount_total: 25.0,
        currency_rate: 1.0,
        match_qty_tolerance: None,
        match_price_tolerance: None,
        receipt_status: "pending".to_string(),
        notes: None,
        message_main_attachment_id: None,
        message_follower_ids: vec![],
        message_ids: vec![],
        has_message: false,
        activity_ids: vec![],
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        access_url: None,
        access_token: None,
        access_warning: None,
        is_locked: false,
        is_quantity_copy: "none".to_string(),
        incoterm_id: None,
        incoterm_location: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(r#"{"test":"guarded-action"}"#.to_string()),
    })
}

fn insert_draft_move(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> AccountMove {
    ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id: fixture.organization_id,
        name: name.to_string(),
        ref_: None,
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: None,
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(fixture.partner_id),
        commercial_partner_id: Some(fixture.partner_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id: fixture.company_id,
        journal_id: 991_002,
        currency_id: 1,
        company_currency_id: 1,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
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
        metadata: Some(r#"{"test":"guarded-action"}"#.to_string()),
    })
}

fn add_test_move_line(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    move_id: u64,
    debit: f64,
    credit: f64,
    sequence: u32,
) -> Result<(), String> {
    add_account_move_line(
        ctx,
        fixture.organization_id,
        move_id,
        AddAccountMoveLineParams {
            account_id: fixture.chart_account_ids[chart_keys::AR],
            name: "Workflow action test line".to_string(),
            debit,
            credit,
            sequence,
            quantity: 1.0,
            price_unit: debit.max(credit),
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
    )
}

fn input_hash(action: &GuardedActionKey, subject_id: u64) -> String {
    canonical_hash(&[
        action.as_str(),
        &GUARDED_ACTION_SCHEMA_VERSION.to_string(),
        &subject_id.to_string(),
    ])
}

fn receipt_id(organization_id: u64, company_id: u64, idempotency_key: &str) -> String {
    canonical_hash(&[
        "guarded-action-receipt",
        &organization_id.to_string(),
        &company_id.to_string(),
        idempotency_key,
    ])
}

#[allow(clippy::too_many_arguments)]
fn invocation_hash(
    organization_id: u64,
    company_id: u64,
    subject_kind: &GuardedActionSubjectKind,
    subject_id: u64,
    action: &GuardedActionKey,
    input_hash: &str,
    revision_hash: &str,
) -> String {
    canonical_hash(&[
        &organization_id.to_string(),
        &company_id.to_string(),
        subject_kind.as_str(),
        &subject_id.to_string(),
        action.as_str(),
        &GUARDED_ACTION_SCHEMA_VERSION.to_string(),
        input_hash,
        revision_hash,
    ])
}

fn canonical_hash(fields: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for value in fields {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}
